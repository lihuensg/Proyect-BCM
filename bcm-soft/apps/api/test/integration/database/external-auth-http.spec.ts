import "reflect-metadata";

import { Writable } from "node:stream";

import { NestFactory } from "@nestjs/core";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../../src/app.module.js";
import { configureCors } from "../../../src/config/cors.js";
import { loadServerConfig } from "../../../src/config/server-config.js";
import { FakeAuth0Tenant } from "../../../src/identity/infrastructure/fake-auth0-tenant.test-support.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import {
  configureObservability,
  createObservability,
} from "../../../src/observability/observability.js";

const WEB_APP_ORIGIN = "http://localhost:5173";
const CALLBACK_URL = "http://localhost:3000/api/auth/auth0/callback";

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

describe("Auth0 login HTTP with PostgreSQL", () => {
  const provider = new FakeAuth0Tenant();
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  const fixtureSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;

  async function createUser(
    input: Readonly<{ status?: "Active" | "Disabled"; subject?: string }> = {},
  ): Promise<Readonly<{ userId: string; subject: string }>> {
    const userId = generateUuidV7();
    const subject = input.subject ?? `auth0|${userId}`;
    const email = `${userId}@auth0.test`;
    await fixtureSql.query(
      `INSERT INTO users (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $2, $3, now(), now())`,
      [userId, email, input.status ?? "Active"],
    );
    await fixtureSql.query(
      `INSERT INTO user_external_identities (id, user_id, provider, subject, created_at)
       VALUES ($1::uuid, $2::uuid, 'auth0', $3, now())`,
      [generateUuidV7(), userId, subject],
    );
    return { userId, subject };
  }

  async function get(path: string, cookie?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      headers: cookie === undefined ? {} : { cookie },
    });
  }

  /** Runs /start, the provider's approval, and the callback, as a browser. */
  async function signIn(
    subject: string,
    cookie?: string,
  ): Promise<Readonly<{ callback: Response; transactionCookie: string }>> {
    const start = await get("/api/auth/auth0/start", cookie);
    expect(start.status).toBe(303);
    const transactionCookie = cookiePair(start.headers.getSetCookie()[0] ?? "");
    const providerCallback = new URL(
      provider.approve(start.headers.get("location") ?? "", subject),
    );
    const callback = await get(
      `/api/auth/auth0/callback${providerCallback.search}`,
      [cookie, transactionCookie].filter(Boolean).join("; "),
    );
    return { callback, transactionCookie };
  }

  function sessionCookieFrom(response: Response): string | null {
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("bcm_session="));
    return cookie === undefined ? null : cookiePair(cookie);
  }

  beforeAll(async () => {
    await provider.start();
    await fixtureSql.connect();
    const config = loadServerConfig({
      ...process.env,
      NODE_ENV: "test",
      TRUSTED_ORIGINS: WEB_APP_ORIGIN,
      WEB_APP_ORIGIN,
      AUTH0_ISSUER_URL: provider.issuerUrl,
      AUTH0_CLIENT_ID: provider.clientId,
      AUTH0_CLIENT_SECRET: provider.clientSecret,
      AUTH0_CALLBACK_URL: CALLBACK_URL,
    });
    const observability = createObservability(config, {
      destination,
      level: "debug",
    });
    app = await NestFactory.create(
      AppModule.register(config, observability.logger),
      { logger: observability.logger },
    );
    app.setGlobalPrefix("api");
    configureCors(app, config);
    configureObservability(app, observability);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }, 30_000);

  beforeEach(() => {
    chunks.length = 0;
    provider.useIdTokenOverrides({});
  });

  afterAll(async () => {
    await app.close();
    await fixtureSql.end();
    await provider.stop();
  });

  it("logs a provisioned User in and issues the normal server-side Session", async () => {
    const { userId, subject } = await createUser();
    const { callback } = await signIn(subject);

    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe(`${WEB_APP_ORIGIN}/`);
    const setCookies = callback.headers.getSetCookie();
    expect(setCookies).toContain(
      "bcm_oidc=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
    );
    const sessionCookie = sessionCookieFrom(callback);
    expect(sessionCookie).not.toBeNull();

    const session = await get("/api/auth/session", sessionCookie ?? "");
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      authenticated: true,
      user: { id: userId },
    });
    const rows = await fixtureSql.query(
      "SELECT 1 FROM sessions WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [userId],
    );
    expect(rows.rowCount).toBe(1);

    await new Promise<void>((resolve) => setImmediate(resolve));
    const logs = chunks.join("");
    expect(logs).toContain("identity.external_login.succeeded");
    expect(logs).not.toContain(provider.clientSecret);
    expect(logs).not.toContain(sessionCookie?.split("=")[1] ?? "impossible");
  });

  it("sends the browser to the provider with a signed transaction cookie", async () => {
    const start = await get("/api/auth/auth0/start");
    const location = new URL(start.headers.get("location") ?? "");

    expect(start.status).toBe(303);
    expect(location.origin + location.pathname).toBe(
      `${provider.issuerUrl}authorize`,
    );
    expect(location.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(start.headers.getSetCookie()).toEqual([
      expect.stringMatching(
        /^bcm_oidc=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax$/u,
      ),
    ]);
  });

  it.each([
    ["a never-provisioned subject", "auth0|unknown", "Active"],
    ["a disabled User", null, "Disabled"],
  ] as const)(
    "denies %s without creating a Session",
    async (_name, unknownSubject, status) => {
      const { userId, subject } = await createUser({ status });
      const { callback } = await signIn(unknownSubject ?? subject);

      expect(callback.headers.get("location")).toBe(
        `${WEB_APP_ORIGIN}/login?error=access_denied`,
      );
      expect(sessionCookieFrom(callback)).toBeNull();
      const rows = await fixtureSql.query(
        "SELECT 1 FROM sessions WHERE user_id = $1::uuid",
        [userId],
      );
      expect(rows.rowCount).toBe(0);
    },
  );

  it("rejects a callback without the browser's transaction cookie before the code exchange", async () => {
    const { subject } = await createUser();
    const start = await get("/api/auth/auth0/start");
    const providerCallback = new URL(
      provider.approve(start.headers.get("location") ?? "", subject),
    );
    const before = provider.tokenRequests;

    const callback = await get(
      `/api/auth/auth0/callback${providerCallback.search}`,
    );

    expect(callback.headers.get("location")).toBe(
      `${WEB_APP_ORIGIN}/login?error=login_failed`,
    );
    expect(sessionCookieFrom(callback)).toBeNull();
    expect(provider.tokenRequests).toBe(before);
  });

  it("rejects a transaction cookie replayed against another state", async () => {
    const { subject } = await createUser();
    const first = await signIn(subject);
    expect(sessionCookieFrom(first.callback)).not.toBeNull();

    const second = await get("/api/auth/auth0/start");
    const providerCallback = new URL(
      provider.approve(second.headers.get("location") ?? "", subject),
    );
    const replay = await get(
      `/api/auth/auth0/callback${providerCallback.search}`,
      first.transactionCookie,
    );

    expect(replay.headers.get("location")).toBe(
      `${WEB_APP_ORIGIN}/login?error=login_failed`,
    );
  });

  it("maps a provider-side refusal to access_denied", async () => {
    const start = await get("/api/auth/auth0/start");
    const transactionCookie = cookiePair(start.headers.getSetCookie()[0] ?? "");
    const state =
      new URL(start.headers.get("location") ?? "").searchParams.get("state") ??
      "";

    const callback = await get(
      `/api/auth/auth0/callback?${new URLSearchParams({
        error: "access_denied",
        error_description: "user is blocked",
        state,
      })}`,
      transactionCookie,
    );

    expect(callback.headers.get("location")).toBe(
      `${WEB_APP_ORIGIN}/login?error=access_denied`,
    );
  });

  it("rejects an ID token signed with an unpublished key", async () => {
    const { subject } = await createUser();
    provider.useIdTokenOverrides({ foreignKey: true });

    const { callback } = await signIn(subject);

    expect(callback.headers.get("location")).toBe(
      `${WEB_APP_ORIGIN}/login?error=login_failed`,
    );
    expect(sessionCookieFrom(callback)).toBeNull();
  });

  it("returns the browser through the provider's logout to the login page", async () => {
    const logout = await get("/api/auth/auth0/logout");
    const location = new URL(logout.headers.get("location") ?? "");

    expect(logout.status).toBe(303);
    expect(location.origin + location.pathname).toBe(
      `${provider.issuerUrl}oidc/logout`,
    );
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
      `${WEB_APP_ORIGIN}/login`,
    );
  });
});
