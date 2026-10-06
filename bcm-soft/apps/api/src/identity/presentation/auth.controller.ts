import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";

import { LogoutUseCase } from "../application/logout-use-case.js";
import { SessionBootstrapUseCase } from "../application/session-bootstrap-use-case.js";
import { SafeHttpException } from "../../observability/safe-http-exception.js";
import { SessionCookieCodec } from "./session-cookie-codec.js";
import { NodeCsrfTokenService } from "../infrastructure/node-csrf-token-service.js";
import { PinoIdentityAudit } from "../infrastructure/pino-identity-audit.js";
import {
  readSingleHeader,
  type RawHeadersRequest,
  TrustedOriginValidator,
} from "./trusted-origin-validator.js";

type HeaderResponse = Readonly<{
  setHeader(name: string, value: string): void;
}>;

type HttpRequest = RawHeadersRequest;

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

@Controller("auth")
export class AuthController {
  constructor(
    private readonly logoutUseCase: LogoutUseCase,
    private readonly sessionBootstrapUseCase: SessionBootstrapUseCase,
    private readonly cookies: SessionCookieCodec,
    private readonly origins: TrustedOriginValidator,
    private readonly csrfTokens: NodeCsrfTokenService,
    private readonly audit: PinoIdentityAudit,
  ) {}

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
