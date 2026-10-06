import { createHash, timingSafeEqual } from "node:crypto";

import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

import type { Auth0Config } from "../../config/server-config.js";
import {
  type ExternalIdentityProvider,
  ExternalIdentityProviderError,
  type ExternalLoginTransaction,
  type VerifiedExternalIdentity,
} from "../application/external-login-use-case.js";

const DISCOVERY_TIMEOUT_MILLISECONDS = 5_000;
const TOKEN_TIMEOUT_MILLISECONDS = 10_000;
const CLOCK_TOLERANCE_SECONDS = 30;
const MAX_SUBJECT_LENGTH = 255;

type ProviderMetadata = Readonly<{
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  endSessionEndpoint: URL | null;
  keys: ReturnType<typeof createRemoteJWKSet>;
}>;

function sameSecret(expected: string, received: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(received, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function codeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Auth0 endpoints live on the issuer's own origin. Rejecting any other origin
 * keeps a tampered discovery document from redirecting the code exchange.
 */
function sameOriginEndpoint(issuer: URL, value: unknown): URL {
  if (typeof value !== "string") throw new ExternalIdentityProviderError();
  const url = new URL(value);
  if (url.origin !== issuer.origin) throw new ExternalIdentityProviderError();
  return url;
}

export class Auth0OidcProvider implements ExternalIdentityProvider {
  private readonly issuer: URL;
  private metadata: Promise<ProviderMetadata> | null = null;

  constructor(
    private readonly config: Auth0Config,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.issuer = new URL(config.issuerUrl);
  }

  async authorizationUrl(
    transaction: ExternalLoginTransaction,
  ): Promise<string> {
    const { authorizationEndpoint } = await this.loadMetadata();
    const url = new URL(authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.callbackUrl,
      // BCM needs only the stable subject; no profile or email claims.
      scope: "openid",
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: codeChallenge(transaction.codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    return url.href;
  }

  async logoutUrl(returnTo: string): Promise<string> {
    const { endSessionEndpoint } = await this.loadMetadata();
    if (endSessionEndpoint !== null) {
      const url = new URL(endSessionEndpoint);
      url.search = new URLSearchParams({
        client_id: this.config.clientId,
        post_logout_redirect_uri: returnTo,
      }).toString();
      return url.href;
    }
    // Tenants without OIDC RP-initiated logout enabled use Auth0's endpoint.
    const url = new URL("v2/logout", this.issuer);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      returnTo,
    }).toString();
    return url.href;
  }

  async verifyAuthorizationCode(
    input: Readonly<{ code: string; codeVerifier: string; nonce: string }>,
  ): Promise<VerifiedExternalIdentity> {
    try {
      const metadata = await this.loadMetadata();
      const idToken = await this.exchangeCode(metadata.tokenEndpoint, input);
      const { payload } = await jwtVerify(idToken, metadata.keys, {
        issuer: this.config.issuerUrl,
        audience: this.config.clientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "iat", "exp", "nonce"],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      return this.toIdentity(payload, input.nonce);
    } catch {
      // Provider, network, and token details never leave this adapter.
      throw new ExternalIdentityProviderError();
    }
  }

  private toIdentity(
    payload: JWTPayload,
    expectedNonce: string,
  ): VerifiedExternalIdentity {
    // OIDC Core 3.1.3.7: with several audiences, azp must be this client.
    if (
      Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== this.config.clientId
    ) {
      throw new ExternalIdentityProviderError();
    }
    if (
      typeof payload.nonce !== "string" ||
      !sameSecret(expectedNonce, payload.nonce)
    ) {
      throw new ExternalIdentityProviderError();
    }
    const subject = payload.sub;
    if (
      typeof subject !== "string" ||
      subject.length === 0 ||
      subject.length > MAX_SUBJECT_LENGTH
    ) {
      throw new ExternalIdentityProviderError();
    }
    return Object.freeze({ provider: "auth0", subject });
  }

  private async exchangeCode(
    tokenEndpoint: URL,
    input: Readonly<{ code: string; codeVerifier: string }>,
  ): Promise<string> {
    const response = await this.fetchImplementation(tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: this.config.callbackUrl,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MILLISECONDS),
    });
    if (!response.ok) throw new ExternalIdentityProviderError();
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.id_token !== "string") {
      throw new ExternalIdentityProviderError();
    }
    return body.id_token;
  }

  private loadMetadata(): Promise<ProviderMetadata> {
    if (this.metadata === null) {
      const pending = this.discover();
      this.metadata = pending;
      // A failed discovery is retried on the next login instead of cached.
      pending.catch(() => {
        if (this.metadata === pending) this.metadata = null;
      });
    }
    return this.metadata;
  }

  private async discover(): Promise<ProviderMetadata> {
    try {
      const response = await this.fetchImplementation(
        new URL(".well-known/openid-configuration", this.issuer),
        {
          headers: { accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MILLISECONDS),
        },
      );
      if (!response.ok) throw new ExternalIdentityProviderError();
      const document: unknown = await response.json();
      if (!isRecord(document) || document.issuer !== this.config.issuerUrl) {
        throw new ExternalIdentityProviderError();
      }
      return Object.freeze({
        authorizationEndpoint: sameOriginEndpoint(
          this.issuer,
          document.authorization_endpoint,
        ),
        tokenEndpoint: sameOriginEndpoint(this.issuer, document.token_endpoint),
        endSessionEndpoint:
          document.end_session_endpoint === undefined
            ? null
            : sameOriginEndpoint(this.issuer, document.end_session_endpoint),
        keys: createRemoteJWKSet(
          sameOriginEndpoint(this.issuer, document.jwks_uri),
          { timeoutDuration: DISCOVERY_TIMEOUT_MILLISECONDS },
        ),
      });
    } catch {
      throw new ExternalIdentityProviderError();
    }
  }
}
