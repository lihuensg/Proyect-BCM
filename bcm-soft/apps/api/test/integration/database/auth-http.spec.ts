import "reflect-metadata";

import { Writable } from "node:stream";

import { NestFactory } from "@nestjs/core";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../../src/app.module.js";
import { configureCors } from "../../../src/config/cors.js";
import { loadServerConfig } from "../../../src/config/server-config.js";
import { SessionService } from "../../../src/identity/application/session-service.js";
import { NodeSessionTokenService } from "../../../src/identity/infrastructure/node-session-token-service.js";
import { PrismaSessionRepository } from "../../../src/identity/infrastructure/prisma-session-repository.js";
import { SystemClock } from "../../../src/identity/infrastructure/system-clock.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import {
  configureObservability,
  createObservability,
} from "../../../src/observability/observability.js";

type CreatedIdentity = Readonly<{ email: string; userId: string }>;

/**
 * Session lifecycle, bootstrap, logout, CSRF, and CORS. Sessions are issued
 * with the same SessionService the Auth0 callback uses; the login itself is
 * covered by external-auth-http.spec.ts.
 */
describe("Identity HTTP with PostgreSQL", () => {
  const config = loadServerConfig({
    ...process.env,
    NODE_ENV: "production",
    PORT: "3000",
  });
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  const observability = createObservability(config, {
    destination,
    level: "debug",
  });
  const fixtureSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });
  const sessionLifecycle = new PrismaClientLifecycle(
    config.database.runtimeUrl,
  );
  let sessions: SessionService;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;

  async function createIdentity(): Promise<CreatedIdentity> {
    const userId = generateUuidV7();
    const email = `${userId}@auth.test`;
    await fixtureSql.query(
      `INSERT INTO users
        (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $2, 'Active', now(), now())`,
      [userId, email],
    );
    return { email, userId };
  }

  async function sessionCookieFor(userId: string): Promise<string> {
    const created = await sessions.createSession(userId);
    return `${config.sessionCookie.name}=${created.rawToken}`;
  }

  async function request(
    path: string,
    input: Readonly<{
      cookie?: string;
      method?: "GET" | "POST";
      csrfToken?: string;
      origin?: string | null;
    }> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (input.origin !== null)
      headers.origin = input.origin ?? "https://app.bcm.test";
    if (input.cookie !== undefined) headers.cookie = input.cookie;
    if (input.csrfToken !== undefined)
      headers["x-csrf-token"] = input.csrfToken;

    return fetch(`${baseUrl}${path}`, {
      method: input.method ?? "GET",
      headers,
    });
  }

  beforeAll(async () => {
    await fixtureSql.connect();
    sessions = new SessionService(
      new PrismaSessionRepository(await sessionLifecycle.connect()),
      new NodeSessionTokenService(),
      new SystemClock(),
      generateUuidV7,
      config.session,
    );
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
  });

  afterAll(async () => {
    await app.close();
    await sessionLifecycle.disconnect();
    await fixtureSql.end();
  });

  it("emits credentialed CORS headers only for an exact trusted origin", async () => {
    const trusted = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.bcm.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-csrf-token,content-type",
      },
    });
    expect(trusted.status).toBe(204);
    expect(trusted.headers.get("access-control-allow-origin")).toBe(
      "https://app.bcm.test",
    );
    expect(trusted.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(
      trusted.headers.get("access-control-allow-headers")?.toLowerCase(),
    ).toContain("x-csrf-token");

    const untrusted = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.bcm.test.evil",
        "access-control-request-method": "POST",
      },
    });
    expect(untrusted.headers.get("access-control-allow-origin")).toBeNull();
    expect(
      untrusted.headers.get("access-control-allow-credentials"),
    ).toBeNull();
  });

  it("bootstraps only a valid active session and omits authority internals", async () => {
    const identity = await createIdentity();
    const cookie = await sessionCookieFor(identity.userId);

    const valid = await request("/api/auth/session", { cookie });
    expect(valid.status).toBe(200);
    const bootstrap = (await valid.json()) as {
      authenticated: boolean;
      user: { id: string };
      csrfToken: string;
    };
    expect(bootstrap).toMatchObject({
      authenticated: true,
      user: { id: identity.userId },
    });
    expect(bootstrap.csrfToken).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/u);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(chunks.join("")).not.toContain(cookie);
    expect(chunks.join("")).not.toContain(bootstrap.csrfToken);

    for (const invalidCookie of [
      undefined,
      "__Host-bcm_session=malformed",
      `__Host-bcm_session=${"Z".repeat(43)}`,
      `${cookie}; __Host-bcm_session=${"Q".repeat(43)}`,
    ]) {
      const response = await request("/api/auth/session", {
        ...(invalidCookie === undefined ? {} : { cookie: invalidCookie }),
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "AUTHENTICATION_REQUIRED",
      });
    }

    const unrelated = await request("/api/auth/session", {
      cookie: `theme=dark; ${cookie}; locale=es`,
    });
    expect(unrelated.status).toBe(200);
  });

  it("rejects revoked, expired, and Disabled sessions with the same 401", async () => {
    const identities = [
      await createIdentity(),
      await createIdentity(),
      await createIdentity(),
    ];
    const cookies: string[] = [];
    for (const identity of identities) {
      cookies.push(await sessionCookieFor(identity.userId));
    }

    await fixtureSql.query(
      "UPDATE sessions SET revoked_at = created_at WHERE user_id = $1::uuid",
      [identities[0]?.userId],
    );
    await fixtureSql.query(
      `UPDATE sessions
       SET expires_at = created_at + interval '1 millisecond'
       WHERE user_id = $1::uuid`,
      [identities[1]?.userId],
    );
    await fixtureSql.query(
      "UPDATE users SET status = 'Disabled', updated_at = now() WHERE id = $1::uuid",
      [identities[2]?.userId],
    );

    for (const cookie of cookies) {
      const response = await request("/api/auth/session", { cookie });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "AUTHENTICATION_REQUIRED",
      });
    }
  });

  it("logs out idempotently, always clears the cookie, and prevents replay", async () => {
    const identity = await createIdentity();
    const cookie = await sessionCookieFor(identity.userId);

    const bootstrapResponse = await request("/api/auth/session", { cookie });
    const { csrfToken } = (await bootstrapResponse.json()) as {
      csrfToken: string;
    };

    const firstLogout = await request("/api/auth/logout", {
      method: "POST",
      cookie,
      csrfToken,
    });
    expect(firstLogout.status).toBe(204);

    for (const suppliedCookie of [
      cookie,
      undefined,
      "__Host-bcm_session=malformed",
      `__Host-bcm_session=${"Y".repeat(43)}`,
    ]) {
      const response = await request("/api/auth/logout", {
        method: "POST",
        ...(suppliedCookie === undefined ? {} : { cookie: suppliedCookie }),
      });
      expect(response.status).toBe(204);
      const cleared = response.headers.get("set-cookie");
      expect(cleared).toContain("__Host-bcm_session=;");
      expect(cleared).toContain("Max-Age=0");
      expect(cleared).toContain("Path=/");
      expect(cleared).toContain("HttpOnly");
      expect(cleared).toContain("SameSite=Lax");
      expect(cleared).toContain("Secure");
      expect(cleared).not.toContain("Domain=");
    }

    expect((await request("/api/auth/session", { cookie })).status).toBe(401);
    const session = await fixtureSql.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM sessions WHERE user_id = $1::uuid",
      [identity.userId],
    );
    expect(session.rows[0]?.revoked_at).toBeInstanceOf(Date);
  });

  it("does not revoke or clear a valid session when CSRF validation fails", async () => {
    const identity = await createIdentity();
    const cookie = await sessionCookieFor(identity.userId);
    const bootstrapResponse = await request("/api/auth/session", { cookie });
    const { csrfToken } = (await bootstrapResponse.json()) as {
      csrfToken: string;
    };

    const rejected = await request("/api/auth/logout", {
      method: "POST",
      cookie,
      csrfToken: `v1.${"A".repeat(43)}`,
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    await expect(rejected.json()).resolves.toMatchObject({
      code: "CSRF_VALIDATION_FAILED",
    });
    expect((await request("/api/auth/session", { cookie })).status).toBe(200);

    expect(
      (await request("/api/auth/logout", { method: "POST", cookie, csrfToken }))
        .status,
    ).toBe(204);
  });

  it("binds CSRF to one session and keeps rejected mutations effect-free", async () => {
    const identity = await createIdentity();
    const firstCookie = await sessionCookieFor(identity.userId);
    const firstBootstrap = (await (
      await request("/api/auth/session", { cookie: firstCookie })
    ).json()) as { csrfToken: string };

    const secondCookie = await sessionCookieFor(identity.userId);
    const secondBootstrap = (await (
      await request("/api/auth/session", { cookie: secondCookie })
    ).json()) as { csrfToken: string };
    expect(secondBootstrap.csrfToken).not.toBe(firstBootstrap.csrfToken);

    for (const csrfToken of [
      undefined,
      "malformed",
      firstBootstrap.csrfToken,
    ]) {
      const rejected = await request("/api/auth/logout", {
        method: "POST",
        cookie: secondCookie,
        ...(csrfToken === undefined ? {} : { csrfToken }),
      });
      expect(rejected.status).toBe(403);
      expect(rejected.headers.get("set-cookie")).toBeNull();
      expect(
        (await request("/api/auth/session", { cookie: secondCookie })).status,
      ).toBe(200);
    }

    const crossOrigin = await request("/api/auth/logout", {
      method: "POST",
      cookie: secondCookie,
      csrfToken: secondBootstrap.csrfToken,
      origin: "https://evil.test",
    });
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("set-cookie")).toBeNull();
    expect(
      (await request("/api/auth/session", { cookie: secondCookie })).status,
    ).toBe(200);

    expect(
      (
        await request("/api/auth/logout", {
          method: "POST",
          cookie: secondCookie,
          csrfToken: secondBootstrap.csrfToken,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await request("/api/auth/logout", {
          method: "POST",
          cookie: secondCookie,
          csrfToken: secondBootstrap.csrfToken,
        })
      ).status,
    ).toBe(204);
  });
});
