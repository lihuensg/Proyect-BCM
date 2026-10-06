import {
  Controller,
  Get,
  Headers,
  Inject,
  Query,
  Redirect,
  Req,
  Res,
} from "@nestjs/common";

import type { Auth0Config } from "../../config/server-config.js";
import {
  type ExternalIdentityProvider,
  ExternalIdentityProviderError,
  type ExternalLoginDenialReason,
  ExternalLoginUseCase,
} from "../application/external-login-use-case.js";
import { LocalNetworkRateLimiter } from "../application/local-network-rate-limiter.js";
import { PinoIdentityAudit } from "../infrastructure/pino-identity-audit.js";
import { canonicalizeClientIp } from "./client-ip.js";
import { ExternalLoginTransactionCodec } from "./external-login-transaction-codec.js";
import { SessionCookieCodec } from "./session-cookie-codec.js";

export const AUTH0_CONFIG = Symbol("Auth0Config");
export const EXTERNAL_IDENTITY_PROVIDER = Symbol("ExternalIdentityProvider");

const MAX_STATE_LENGTH = 128;
const MAX_CODE_LENGTH = 512;

type CookieResponse = Readonly<{
  setHeader(name: string, value: string | readonly string[]): void;
}>;

type HttpRequest = Readonly<{
  socket: Readonly<{ remoteAddress?: string }>;
}>;

type RedirectTarget = Readonly<{ url: string; statusCode: number }>;

/** Error codes the Web login page understands; never provider details. */
type LoginErrorCode =
  "access_denied" | "login_failed" | "rate_limited" | "unavailable";

function readQueryString(
  query: Record<string, unknown>,
  name: string,
  maximumLength: number,
): string | null {
  const value = query[name];
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : null;
}

function errorCodeFor(reason: ExternalLoginDenialReason): LoginErrorCode {
  return reason === "not-provisioned" || reason === "session-refused"
    ? "access_denied"
    : "login_failed";
}

/**
 * Browser-navigation endpoints for the OIDC Authorization Code flow with PKCE.
 * The state-bound transaction cookie is the CSRF defense for the callback,
 * which arrives as a top-level GET from the provider without an Origin.
 */
@Controller("auth/auth0")
export class ExternalAuthController {
  constructor(
    @Inject(AUTH0_CONFIG) private readonly config: Auth0Config,
    @Inject(EXTERNAL_IDENTITY_PROVIDER)
    private readonly provider: ExternalIdentityProvider,
    private readonly loginUseCase: ExternalLoginUseCase,
    private readonly transactions: ExternalLoginTransactionCodec,
    private readonly sessionCookies: SessionCookieCodec,
    private readonly localRateLimiter: LocalNetworkRateLimiter,
    private readonly audit: PinoIdentityAudit,
  ) {}

  @Get("start")
  @Redirect()
  async start(
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<RedirectTarget> {
    const { transaction, setCookie } = this.transactions.issue();
    let authorizationUrl: string;
    try {
      authorizationUrl = await this.provider.authorizationUrl(transaction);
    } catch (error: unknown) {
      if (!(error instanceof ExternalIdentityProviderError)) throw error;
      this.audit.recordExternalLoginDenied("provider-error");
      return this.loginPage("unavailable");
    }
    response.setHeader("set-cookie", setCookie);
    return { url: authorizationUrl, statusCode: 303 };
  }

  @Get("callback")
  @Redirect()
  async callback(
    @Query() query: Record<string, unknown>,
    @Headers("cookie") cookieHeader: string | undefined,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<RedirectTarget> {
    const clearTransaction = this.transactions.serializeClear();
    response.setHeader("set-cookie", clearTransaction);

    const clientIp = canonicalizeClientIp(request.socket.remoteAddress);
    if (clientIp === null) return this.loginPage("login_failed");
    if (!this.localRateLimiter.consume(clientIp).allowed) {
      return this.loginPage("rate_limited");
    }

    const state = readQueryString(query, "state", MAX_STATE_LENGTH);
    const transaction =
      state === null
        ? null
        : this.transactions.readMatching(cookieHeader, state);
    if (transaction === null) {
      this.audit.recordExternalLoginDenied("state-mismatch");
      return this.loginPage("login_failed");
    }
    // The user cancelled, or the provider refused (blocked user, no signup).
    if (query.error !== undefined) {
      this.audit.recordExternalLoginDenied("provider-rejected");
      return this.loginPage("access_denied");
    }
    const code = readQueryString(query, "code", MAX_CODE_LENGTH);
    if (code === null) {
      this.audit.recordExternalLoginDenied("provider-error");
      return this.loginPage("login_failed");
    }

    const result = await this.loginUseCase.complete({ transaction, code });
    if (result.status === "denied") {
      return this.loginPage(errorCodeFor(result.reason));
    }

    // Like password login, a new Session replaces the cookie without adopting
    // or revoking whatever Session the browser presented.
    response.setHeader("set-cookie", [
      clearTransaction,
      this.sessionCookies.serialize(
        result.session.rawToken,
        result.session.expiresAt,
      ),
    ]);
    return { url: `${this.config.webAppOrigin}/`, statusCode: 303 };
  }

  /**
   * Ends the provider's SSO session after the Web has revoked the BCM Session
   * through POST /api/auth/logout. This GET changes no BCM state.
   */
  @Get("logout")
  @Redirect()
  async logout(): Promise<RedirectTarget> {
    const returnTo = `${this.config.webAppOrigin}/login`;
    try {
      return { url: await this.provider.logoutUrl(returnTo), statusCode: 303 };
    } catch (error: unknown) {
      if (!(error instanceof ExternalIdentityProviderError)) throw error;
      return { url: returnTo, statusCode: 303 };
    }
  }

  private loginPage(error: LoginErrorCode): RedirectTarget {
    return {
      url: `${this.config.webAppOrigin}/login?error=${error}`,
      statusCode: 303,
    };
  }
}
