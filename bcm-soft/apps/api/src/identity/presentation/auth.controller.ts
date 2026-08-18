import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Res,
} from "@nestjs/common";

import { EmailAddressError } from "../application/email-address.js";
import { LoginUseCase } from "../application/login-use-case.js";
import { LogoutUseCase } from "../application/logout-use-case.js";
import { SessionBootstrapUseCase } from "../application/session-bootstrap-use-case.js";
import { SafeHttpException } from "../../observability/safe-http-exception.js";
import { SessionCookieCodec } from "./session-cookie-codec.js";

type HeaderResponse = Readonly<{
  setHeader(name: string, value: string): void;
}>;

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
  ) {}

  @Post("login")
  @HttpCode(204)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<void> {
    let loginRequest: LoginRequest;
    try {
      loginRequest = parseLoginRequest(body);
    } catch (error: unknown) {
      if (error instanceof SafeHttpException) throw error;
      throw invalidRequest();
    }

    try {
      const result = await this.loginUseCase.execute(loginRequest);
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
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<void> {
    response.setHeader("set-cookie", this.cookies.serializeClear());
    await this.logoutUseCase.execute(this.cookies.parse(cookieHeader));
  }

  @Get("session")
  async session(
    @Headers("cookie") cookieHeader: string | undefined,
  ): Promise<
    Readonly<{ authenticated: true; user: Readonly<{ id: string }> }>
  > {
    const result = await this.sessionBootstrapUseCase.execute(
      this.cookies.parse(cookieHeader),
    );
    if (result.status === "invalid") throw authenticationRequired();

    return {
      authenticated: true,
      user: result.user,
    };
  }
}
