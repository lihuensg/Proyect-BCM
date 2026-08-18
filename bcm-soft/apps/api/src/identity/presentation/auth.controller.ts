import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";

import { EmailAddressError } from "../application/email-address.js";
import { LoginUseCase } from "../application/login-use-case.js";
import { LogoutUseCase } from "../application/logout-use-case.js";
import { SessionBootstrapUseCase } from "../application/session-bootstrap-use-case.js";
import { SafeHttpException } from "../../observability/safe-http-exception.js";
import { SessionCookieCodec } from "./session-cookie-codec.js";
import { LocalNetworkRateLimiter } from "../application/local-network-rate-limiter.js";
import { NodeCsrfTokenService } from "../infrastructure/node-csrf-token-service.js";
import { PinoIdentityAudit } from "../infrastructure/pino-identity-audit.js";
import { canonicalizeClientIp } from "./client-ip.js";
import {
  readSingleHeader,
  type RawHeadersRequest,
  TrustedOriginValidator,
} from "./trusted-origin-validator.js";

type HeaderResponse = Readonly<{
  setHeader(name: string, value: string): void;
}>;

type HttpRequest = RawHeadersRequest &
  Readonly<{ socket: Readonly<{ remoteAddress?: string }> }>;

type LoginRequest = Readonly<{
  email: unknown;
  password: string;
}>;

function invalidRequest(): SafeHttpException {
  return new SafeHttpException(
    400,
    "INVALID_REQUEST",
    "La solicitud no es válida.",
  );
}

function authenticationRequired(): SafeHttpException {
  return new SafeHttpException(
    401,
    "AUTHENTICATION_REQUIRED",
    "Se requiere una sesión válida.",
  );
}

function originRejected(): SafeHttpException {
  return new SafeHttpException(
    403,
    "ORIGIN_VALIDATION_FAILED",
    "El origen de la solicitud no es v\u00e1lido.",
  );
}

function csrfRejected(): SafeHttpException {
  return new SafeHttpException(
    403,
    "CSRF_VALIDATION_FAILED",
    "La validaci\u00f3n de seguridad fall\u00f3.",
  );
}

function parseLoginRequest(body: unknown): LoginRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest();
  }

  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(input, "email") ||
    !Object.hasOwn(input, "password") ||
    typeof input.password !== "string"
  ) {
    throw invalidRequest();
  }

  return { email: input.email, password: input.password };
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly sessionBootstrapUseCase: SessionBootstrapUseCase,
    private readonly cookies: SessionCookieCodec,
    private readonly origins: TrustedOriginValidator,
    private readonly csrfTokens: NodeCsrfTokenService,
    private readonly localRateLimiter: LocalNetworkRateLimiter,
    private readonly audit: PinoIdentityAudit,
  ) {}

  @Post("login")
  @HttpCode(204)
  async login(
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<void> {
    let loginRequest: LoginRequest;
    try {
      loginRequest = parseLoginRequest(body);
    } catch (error: unknown) {
      if (error instanceof SafeHttpException) throw error;
      throw invalidRequest();
    }

    const clientIp = canonicalizeClientIp(request.socket.remoteAddress);
    if (clientIp === null) throw invalidRequest();
    const localLimit = this.localRateLimiter.consume(clientIp);
    if (!this.origins.accepts(request)) {
      this.audit.recordOriginRejected("login");
      throw originRejected();
    }
    if (!localLimit.allowed) {
      response.setHeader("retry-after", String(localLimit.retryAfterSeconds));
      this.audit.recordLoginRateLimited(localLimit.retryAfterSeconds);
      throw new SafeHttpException(
        429,
        "TOO_MANY_REQUESTS",
        "Demasiados intentos. Intent\u00e1 nuevamente m\u00e1s tarde.",
      );
    }

    try {
      const result = await this.loginUseCase.execute({
        ...loginRequest,
        clientIp,
      });
      if (result.status === "rate-limited") {
        response.setHeader("retry-after", String(result.retryAfterSeconds));
        throw new SafeHttpException(
          429,
          "TOO_MANY_REQUESTS",
          "Demasiados intentos. Intent\u00e1 nuevamente m\u00e1s tarde.",
        );
      }
      if (result.status === "invalid") {
        throw new SafeHttpException(
          401,
          "INVALID_CREDENTIALS",
          "Las credenciales no son válidas.",
        );
      }

      response.setHeader(
        "set-cookie",
        this.cookies.serialize(
          result.session.rawToken,
          result.session.expiresAt,
        ),
      );
    } catch (error: unknown) {
      if (error instanceof EmailAddressError) throw invalidRequest();
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Headers("cookie") cookieHeader: string | undefined,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<void> {
    if (!this.origins.accepts(request)) {
      this.audit.recordOriginRejected("logout");
      throw originRejected();
    }
    const rawToken = this.cookies.parse(cookieHeader);
    const session = await this.sessionBootstrapUseCase.execute(rawToken);
    if (session.status === "invalid" || rawToken === null) {
      response.setHeader("set-cookie", this.cookies.serializeClear());
      await this.logoutUseCase.execute(null);
      return;
    }
    const csrfToken = readSingleHeader(request, "x-csrf-token");
    if (csrfToken === null || !this.csrfTokens.verify(rawToken, csrfToken)) {
      this.audit.recordCsrfRejected("logout");
      throw csrfRejected();
    }
    response.setHeader("set-cookie", this.cookies.serializeClear());
    await this.logoutUseCase.execute(rawToken);
  }

  @Get("session")
  async session(@Headers("cookie") cookieHeader: string | undefined): Promise<
    Readonly<{
      authenticated: true;
      user: Readonly<{ id: string }>;
      csrfToken: string;
    }>
  > {
    const result = await this.sessionBootstrapUseCase.execute(
      this.cookies.parse(cookieHeader),
    );
    if (result.status === "invalid") throw authenticationRequired();

    return {
      authenticated: true,
      user: result.user,
      csrfToken: result.csrfToken,
    };
  }
}
