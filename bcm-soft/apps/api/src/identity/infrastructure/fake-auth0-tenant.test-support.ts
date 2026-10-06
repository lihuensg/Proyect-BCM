import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";

import type { Auth0Config } from "../../config/server-config.js";

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

type IssuedCode = Readonly<{
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string;
  subject: string;
}>;

export type IdTokenOverrides = Readonly<{
  claims?: JWTPayload;
  /** Sign with a key the provider never published. */
  foreignKey?: boolean;
}>;

/**
 * A minimal Auth0 tenant over loopback HTTP for tests: OIDC discovery, JWKS,
 * single-use authorization codes with PKCE S256, RS256 ID tokens, and the
 * Management/Authentication API calls BCM uses to provision accounts.
 * It never stands in for the real provider outside tests.
 */
type FakeAccount = Readonly<{ subject: string; connection: string }>;

export const FAKE_DATABASE_CONNECTION = "Username-Password-Authentication";

export class FakeAuth0Tenant {
  readonly clientId = "bcm-test-client";
  readonly clientSecret = randomBytes(32).toString("base64url");
  readonly managementClientId = "bcm-test-management-client";
  readonly managementClientSecret = randomBytes(32).toString("base64url");
  private readonly managementToken = randomBytes(24).toString("base64url");
  /** Accounts by email; several per email model social + database logins. */
  readonly accounts = new Map<string, FakeAccount[]>();
  readonly passwordSetupEmails: string[] = [];
  /** Forces the next Management API call to fail. */
  failNextManagementCall = false;
  /** Forces the next password-setup email request to fail. */
  failNextPasswordSetup = false;
  private readonly codes = new Map<string, IssuedCode>();
  private server: Server | null = null;
  private signingKey: SigningKey | null = null;
  private foreignKey: SigningKey | null = null;
  private publicJwk: Record<string, unknown> | null = null;
  private overrides: IdTokenOverrides = {};
  issuerUrl = "";
  tokenRequests = 0;

  async start(): Promise<void> {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const foreign = await generateKeyPair("RS256");
    this.signingKey = pair.privateKey;
    this.foreignKey = foreign.privateKey;
    this.publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "test-key",
      alg: "RS256",
      use: "sig",
    };
    this.server = createServer((request, response) => {
      void this.route(request).then(
        ({ status, body }) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(body));
        },
        () => {
          response.writeHead(500).end();
        },
      );
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, "127.0.0.1", resolve);
    });
    const { port } = this.server.address() as AddressInfo;
    this.issuerUrl = `http://127.0.0.1:${port}/`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (this.server === null) return resolve();
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  config(
    input: Readonly<{ callbackUrl: string; webAppOrigin: string }>,
  ): Auth0Config {
    return Object.freeze({
      issuerUrl: this.issuerUrl,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      callbackUrl: input.callbackUrl,
      webAppOrigin: input.webAppOrigin,
      management: Object.freeze({
        clientId: this.managementClientId,
        clientSecret: this.managementClientSecret,
        connection: FAKE_DATABASE_CONNECTION,
      }),
    });
  }

  seedAccount(email: string, connection = FAKE_DATABASE_CONNECTION): string {
    const subject = `${connection === FAKE_DATABASE_CONNECTION ? "auth0" : "google-oauth2"}|${randomBytes(8).toString("hex")}`;
    this.accounts.set(email, [
      ...(this.accounts.get(email) ?? []),
      { subject, connection },
    ]);
    return subject;
  }

  useIdTokenOverrides(overrides: IdTokenOverrides): void {
    this.overrides = overrides;
  }

  /**
   * Plays the user signing in at the provider: validates the authorization
   * request and returns the URL the provider would redirect the browser to.
   */
  approve(authorizationUrl: string, subject: string): string {
    const params = new URL(authorizationUrl).searchParams;
    const redirectUri = params.get("redirect_uri");
    const state = params.get("state");
    const nonce = params.get("nonce");
    const codeChallenge = params.get("code_challenge");
    if (
      params.get("response_type") !== "code" ||
      params.get("client_id") !== this.clientId ||
      params.get("code_challenge_method") !== "S256" ||
      redirectUri === null ||
      state === null ||
      nonce === null ||
      codeChallenge === null
    ) {
      throw new Error("Invalid authorization request.");
    }
    const code = randomBytes(24).toString("base64url");
    this.codes.set(code, {
      clientId: this.clientId,
      redirectUri,
      codeChallenge,
      nonce,
      subject,
    });
    const callback = new URL(redirectUri);
    callback.search = new URLSearchParams({ code, state }).toString();
    return callback.href;
  }

  private async route(
    request: IncomingMessage,
  ): Promise<Readonly<{ status: number; body: unknown }>> {
    const path = new URL(request.url ?? "/", this.issuerUrl).pathname;
    if (
      request.method === "GET" &&
      path === "/.well-known/openid-configuration"
    ) {
      return {
        status: 200,
        body: {
          issuer: this.issuerUrl,
          authorization_endpoint: `${this.issuerUrl}authorize`,
          token_endpoint: `${this.issuerUrl}oauth/token`,
          jwks_uri: `${this.issuerUrl}.well-known/jwks.json`,
          end_session_endpoint: `${this.issuerUrl}oidc/logout`,
        },
      };
    }
    if (request.method === "GET" && path === "/.well-known/jwks.json") {
      return { status: 200, body: { keys: [this.publicJwk] } };
    }
    if (request.method === "POST" && path === "/oauth/token") {
      const body = await readBody(request);
      if (request.headers["content-type"] === "application/json") {
        return this.managementTokenGrant(
          JSON.parse(body) as Record<string, unknown>,
        );
      }
      this.tokenRequests += 1;
      return this.token(new URLSearchParams(body));
    }
    if (
      path === "/dbconnections/change_password" &&
      request.method === "POST"
    ) {
      return this.passwordSetup(
        JSON.parse(await readBody(request)) as Record<string, unknown>,
      );
    }
    if (path.startsWith("/api/v2/")) {
      if (request.headers.authorization !== `Bearer ${this.managementToken}`) {
        return { status: 401, body: { error: "unauthorized" } };
      }
      if (this.consumeManagementFailure()) return { status: 503, body: {} };
      if (request.method === "POST" && path === "/api/v2/users") {
        return this.createUser(
          JSON.parse(await readBody(request)) as Record<string, unknown>,
        );
      }
      if (request.method === "GET" && path === "/api/v2/users-by-email") {
        const email =
          new URL(request.url ?? "/", this.issuerUrl).searchParams.get(
            "email",
          ) ?? "";
        return {
          status: 200,
          body: (this.accounts.get(email) ?? []).map((account) => ({
            user_id: account.subject,
            email,
            identities: [{ connection: account.connection }],
          })),
        };
      }
    }
    return { status: 404, body: { error: "not_found" } };
  }

  private consumeManagementFailure(): boolean {
    const fail = this.failNextManagementCall;
    this.failNextManagementCall = false;
    return fail;
  }

  private managementTokenGrant(
    body: Record<string, unknown>,
  ): Readonly<{ status: number; body: unknown }> {
    if (
      body.grant_type !== "client_credentials" ||
      body.client_id !== this.managementClientId ||
      body.client_secret !== this.managementClientSecret ||
      body.audience !== `${this.issuerUrl}api/v2/`
    ) {
      return { status: 401, body: { error: "access_denied" } };
    }
    return {
      status: 200,
      body: {
        access_token: this.managementToken,
        expires_in: 86_400,
        token_type: "Bearer",
      },
    };
  }

  private createUser(
    body: Record<string, unknown>,
  ): Readonly<{ status: number; body: unknown }> {
    const email = body.email;
    if (
      typeof email !== "string" ||
      body.connection !== FAKE_DATABASE_CONNECTION ||
      typeof body.password !== "string" ||
      body.email_verified !== false
    ) {
      return { status: 400, body: { error: "invalid_body" } };
    }
    const existing = this.accounts.get(email) ?? [];
    if (existing.some((account) => account.connection === body.connection)) {
      return { status: 409, body: { message: "The user already exists." } };
    }
    return { status: 201, body: { user_id: this.seedAccount(email) } };
  }

  private passwordSetup(
    body: Record<string, unknown>,
  ): Readonly<{ status: number; body: unknown }> {
    if (this.failNextPasswordSetup) {
      this.failNextPasswordSetup = false;
      return { status: 503, body: {} };
    }
    if (
      body.client_id !== this.clientId ||
      body.connection !== FAKE_DATABASE_CONNECTION ||
      typeof body.email !== "string"
    ) {
      return { status: 400, body: { error: "bad_request" } };
    }
    this.passwordSetupEmails.push(body.email);
    return { status: 200, body: "We've just sent you an email." };
  }

  private async token(
    form: URLSearchParams,
  ): Promise<Readonly<{ status: number; body: unknown }>> {
    const code = form.get("code") ?? "";
    const issued = this.codes.get(code);
    this.codes.delete(code);
    const verifier = form.get("code_verifier") ?? "";
    if (
      issued === undefined ||
      form.get("grant_type") !== "authorization_code" ||
      form.get("client_id") !== issued.clientId ||
      form.get("client_secret") !== this.clientSecret ||
      form.get("redirect_uri") !== issued.redirectUri ||
      createHash("sha256").update(verifier).digest("base64url") !==
        issued.codeChallenge
    ) {
      return { status: 400, body: { error: "invalid_grant" } };
    }
    const key = this.overrides.foreignKey ? this.foreignKey : this.signingKey;
    if (key === null) throw new Error("The provider is not started.");
    const now = Math.floor(Date.now() / 1000);
    // Overrides apply last so negative tests really change the signed claim.
    const idToken = await new SignJWT({
      iss: this.issuerUrl,
      aud: this.clientId,
      sub: issued.subject,
      nonce: issued.nonce,
      iat: now,
      exp: now + 600,
      ...this.overrides.claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(key);
    return {
      status: 200,
      body: { id_token: idToken, access_token: "opaque", token_type: "Bearer" },
    };
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
