import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Auth0Config } from "../../config/server-config.js";
import { ExternalIdentityProviderError } from "../application/external-login-use-case.js";
import { Auth0OidcProvider } from "./auth0-oidc-provider.js";
import { FakeAuth0Tenant } from "./fake-auth0-tenant.test-support.js";

const CALLBACK_URL = "http://localhost:3000/api/auth/auth0/callback";

function secret(): string {
  return randomBytes(32).toString("base64url");
}

describe("Auth0OidcProvider", () => {
  const fake = new FakeAuth0Tenant();
  let config: Auth0Config;

  beforeAll(async () => {
    await fake.start();
    config = fake.config({
      callbackUrl: CALLBACK_URL,
      webAppOrigin: "http://localhost:5173",
    });
  });

  afterAll(async () => {
    await fake.stop();
  });

  beforeEach(() => {
    fake.useIdTokenOverrides({});
  });

  async function codeFor(
    provider: Auth0OidcProvider,
    subject = "auth0|user-1",
  ): Promise<Readonly<{ code: string; codeVerifier: string; nonce: string }>> {
    const transaction = {
      state: secret(),
      nonce: secret(),
      codeVerifier: secret(),
    };
    const callback = new URL(
      fake.approve(await provider.authorizationUrl(transaction), subject),
    );
    expect(callback.searchParams.get("state")).toBe(transaction.state);
    return {
      code: callback.searchParams.get("code") ?? "",
      codeVerifier: transaction.codeVerifier,
      nonce: transaction.nonce,
    };
  }

  it("builds a PKCE S256 authorization request with only the openid scope", async () => {
    const provider = new Auth0OidcProvider(config);
    const url = new URL(
      await provider.authorizationUrl({
        state: "s".repeat(43),
        nonce: "n".repeat(43),
        codeVerifier: "v".repeat(43),
      }),
    );

    expect(url.origin + url.pathname).toBe(`${fake.issuerUrl}authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: fake.clientId,
      redirect_uri: CALLBACK_URL,
      scope: "openid",
      state: "s".repeat(43),
      nonce: "n".repeat(43),
      code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      code_challenge_method: "S256",
    });
  });

  it("returns the verified subject for a valid code, verifier, and nonce", async () => {
    const provider = new Auth0OidcProvider(config);
    const input = await codeFor(provider, "auth0|abc123");

    await expect(provider.verifyAuthorizationCode(input)).resolves.toEqual({
      provider: "auth0",
      subject: "auth0|abc123",
    });
  });

  it("rejects a code replay, a wrong verifier, and a wrong nonce", async () => {
    const provider = new Auth0OidcProvider(config);
    const replayed = await codeFor(provider);
    await provider.verifyAuthorizationCode(replayed);
    await expect(
      provider.verifyAuthorizationCode(replayed),
    ).rejects.toBeInstanceOf(ExternalIdentityProviderError);

    const wrongVerifier = await codeFor(provider);
    await expect(
      provider.verifyAuthorizationCode({
        ...wrongVerifier,
        codeVerifier: secret(),
      }),
    ).rejects.toBeInstanceOf(ExternalIdentityProviderError);

    const wrongNonce = await codeFor(provider);
    await expect(
      provider.verifyAuthorizationCode({ ...wrongNonce, nonce: secret() }),
    ).rejects.toBeInstanceOf(ExternalIdentityProviderError);
  });

  it.each([
    ["an unpublished signing key", { foreignKey: true }],
    ["another audience", { claims: { aud: "another-client" } }],
    ["another issuer", { claims: { iss: "https://attacker.test/" } }],
    [
      "an expired token",
      { claims: { exp: Math.floor(Date.now() / 1000) - 120 } },
    ],
    [
      "several audiences without azp",
      { claims: { aud: ["bcm-test-client", "another-client"] } },
    ],
    ["an oversized subject", { claims: { sub: "x".repeat(256) } }],
  ])("rejects an ID token with %s", async (_name, overrides) => {
    const provider = new Auth0OidcProvider(config);
    const input = await codeFor(provider);
    fake.useIdTokenOverrides(overrides);

    await expect(
      provider.verifyAuthorizationCode(input),
    ).rejects.toBeInstanceOf(ExternalIdentityProviderError);
  });

  it("rejects a discovery document for another issuer and retries discovery later", async () => {
    let calls = 0;
    const tampered: typeof fetch = async (input, init) => {
      calls += 1;
      const response = await fetch(input, init);
      if (calls > 1) return response;
      const document = (await response.json()) as Record<string, unknown>;
      return Response.json({ ...document, issuer: "https://attacker.test/" });
    };
    const provider = new Auth0OidcProvider(config, tampered);
    const transaction = {
      state: secret(),
      nonce: secret(),
      codeVerifier: secret(),
    };

    await expect(provider.authorizationUrl(transaction)).rejects.toBeInstanceOf(
      ExternalIdentityProviderError,
    );
    await expect(provider.authorizationUrl(transaction)).resolves.toContain(
      `${fake.issuerUrl}authorize?`,
    );
  });

  it("rejects discovery endpoints on another origin", async () => {
    const tampered: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const document = (await response.json()) as Record<string, unknown>;
      return Response.json({
        ...document,
        token_endpoint: "https://attacker.test/oauth/token",
      });
    };
    const provider = new Auth0OidcProvider(config, tampered);

    await expect(
      provider.authorizationUrl({
        state: secret(),
        nonce: secret(),
        codeVerifier: secret(),
      }),
    ).rejects.toBeInstanceOf(ExternalIdentityProviderError);
  });

  it("uses the discovered end-session endpoint for logout", async () => {
    const provider = new Auth0OidcProvider(config);
    const url = new URL(
      await provider.logoutUrl("http://localhost:5173/login"),
    );

    expect(url.origin + url.pathname).toBe(`${fake.issuerUrl}oidc/logout`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: fake.clientId,
      post_logout_redirect_uri: "http://localhost:5173/login",
    });
  });
});
