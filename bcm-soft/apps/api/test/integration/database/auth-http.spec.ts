import "reflect-metadata";

import { Writable } from "node:stream";

import { NestFactory } from "@nestjs/core";
import { hash as argon2Hash, argon2id } from "argon2";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../../src/app.module.js";
import { loadServerConfig } from "../../../src/config/server-config.js";
import { configureCors } from "../../../src/config/cors.js";
import { CredentialAuthenticator } from "../../../src/identity/application/credential-authenticator.js";
import type { CredentialRepository } from "../../../src/identity/application/credential-repository.js";
import type { IdentityAudit } from "../../../src/identity/application/identity-audit.js";
import { LoginUseCase } from "../../../src/identity/application/login-use-case.js";
import { Argon2PasswordHasher } from "../../../src/identity/infrastructure/argon2-password-hasher.js";
import { PrismaCredentialRepository } from "../../../src/identity/infrastructure/prisma-credential-repository.js";
import { PrismaSessionRepository } from "../../../src/identity/infrastructure/prisma-session-repository.js";
import { NodeSessionTokenService } from "../../../src/identity/infrastructure/node-session-token-service.js";
import { SystemClock } from "../../../src/identity/infrastructure/system-clock.js";
import { SessionService } from "../../../src/identity/application/session-service.js";
import { NodeRateLimitFingerprint } from "../../../src/identity/infrastructure/node-rate-limit-fingerprint.js";
import { PrismaLoginRateLimitStore } from "../../../src/identity/infrastructure/prisma-login-rate-limit-store.js";
import { PersistentLoginRateLimiter } from "../../../src/identity/application/persistent-login-rate-limiter.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import {
  configureObservability,
  createObservability,
} from "../../../src/observability/observability.js";

const PASSWORD = "correct horse battery staple";
const OTHER_PASSWORD = "another correct horse password";

type CreatedIdentity = Readonly<{
  email: string;
  passwordHash: string | null;
  passwordChangedAt: Date | null;
  userId: string;
}>;

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

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
  const hasher = new Argon2PasswordHasher();
  const raceLifecycle = new PrismaClientLifecycle(config.database.runtimeUrl);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;

  async function createIdentity(
    input: Readonly<{
      status?: "Active" | "Disabled";
      passwordHash?: string | null;
      emailPrefix?: string;
    }> = {},
  ): Promise<CreatedIdentity> {
    const userId = generateUuidV7();
    const email = `${input.emailPrefix ?? userId}@auth.test`;
    const now = new Date();
    const passwordHash =
      input.passwordHash === undefined
        ? await hasher.hash(PASSWORD)
        : input.passwordHash;

    await fixtureSql.query(
      `INSERT INTO users
        (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $5)`,
      [userId, email, email.toLowerCase(), input.status ?? "Active", now],
    );

    if (passwordHash !== null) {
      await fixtureSql.query(
        `INSERT INTO user_password_credentials
          (user_id, password_hash, password_changed_at, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $3, $3)`,
        [userId, passwordHash, now],
      );
    }

    return {
      email,
      passwordHash,
      passwordChangedAt: passwordHash === null ? null : now,
      userId,
    };
  }

  async function request(
    path: string,
    input: Readonly<{
      body?: unknown;
      cookie?: string;
      method?: "GET" | "POST";
      csrfToken?: string;
      origin?: string | null;
      referer?: string;
      forwardedFor?: string;
      forwarded?: string;
      realIp?: string;
    }> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (input.origin !== null)
      headers.origin = input.origin ?? "https://app.bcm.test";
    if (input.body !== undefined) headers["content-type"] = "application/json";
    if (input.cookie !== undefined) headers.cookie = input.cookie;
    if (input.csrfToken !== undefined)
      headers["x-csrf-token"] = input.csrfToken;
    if (input.referer !== undefined) headers.referer = input.referer;
    if (input.forwardedFor !== undefined)
      headers["x-forwarded-for"] = input.forwardedFor;
    if (input.forwarded !== undefined) headers.forwarded = input.forwarded;
    if (input.realIp !== undefined) headers["x-real-ip"] = input.realIp;

    return fetch(`${baseUrl}${path}`, {
      method: input.method ?? "GET",
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  }

  async function login(email: string, password = PASSWORD): Promise<Response> {
    return request("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
  }

  beforeAll(async () => {
    await fixtureSql.connect();
    await raceLifecycle.connect();
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
    await raceLifecycle.disconnect();
    await fixtureSql.end();
  });

  it("logs in with a secure opaque cookie and returns no body secret", async () => {
    const identity = await createIdentity();
    const response = await login(`  ${identity.email.toUpperCase()}  `);
    const setCookie = response.headers.get("set-cookie");

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("__Host-bcm_session=");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("Domain=");
    expect(setCookie).toContain("Expires=");

    const sessions = await fixtureSql.query<{
      token_hash: Buffer;
      user_id: string;
    }>("SELECT user_id, token_hash FROM sessions WHERE user_id = $1::uuid", [
      identity.userId,
    ]);
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]?.token_hash).toHaveLength(32);
    expect(setCookie).not.toContain(
      sessions.rows[0]?.token_hash.toString("hex") ?? "impossible",
    );
    const rawToken = cookiePair(setCookie).split("=", 2)[1];
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(rawToken).toHaveLength(43);
    expect(chunks.join("")).not.toContain(rawToken);
  });

  it("always issues a new session without adopting or revoking an old cookie", async () => {
    const identity = await createIdentity();
    const first = await login(identity.email);
    const firstSetCookie = first.headers.get("set-cookie");
    if (firstSetCookie === null)
      throw new Error("Login cookie was not issued.");
    const firstCookie = cookiePair(firstSetCookie);

    const second = await request("/api/auth/login", {
      method: "POST",
      cookie: firstCookie,
      body: { email: identity.email, password: PASSWORD },
    });
    const secondSetCookie = second.headers.get("set-cookie");
    if (secondSetCookie === null)
      throw new Error("Replacement login cookie was not issued.");

    expect(second.status).toBe(204);
    expect(cookiePair(secondSetCookie)).not.toBe(firstCookie);
    const sessions = await fixtureSql.query<{ count: string }>(
      "SELECT count(*) FROM sessions WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [identity.userId],
    );
    expect(sessions.rows[0]?.count).toBe("2");
  });

  it("returns the same safe 401 for every credential failure", async () => {
    const wrong = await createIdentity();
    const disabled = await createIdentity({ status: "Disabled" });
    const missing = await createIdentity({ passwordHash: null });
    const malformed = await createIdentity({ passwordHash: "malformed-phc" });
    const attempts = [
      await login(wrong.email, OTHER_PASSWORD),
      await login("unknown@auth.test"),
      await login(disabled.email),
      await login(missing.email),
      await login(malformed.email),
    ];
    const publicErrors: unknown[] = [];

    for (const response of attempts) {
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
      const body = (await response.json()) as Record<string, unknown>;
      publicErrors.push({
        statusCode: body.statusCode,
        code: body.code,
        message: body.message,
      });
    }

    expect(
      new Set(publicErrors.map((error) => JSON.stringify(error))).size,
    ).toBe(1);
    expect(publicErrors[0]).toEqual({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
      message: "Las credenciales no son válidas.",
    });
    const logOutput = chunks.join("");
    expect(logOutput).not.toContain(PASSWORD);
    expect(logOutput).not.toContain(OTHER_PASSWORD);
    expect(logOutput).not.toContain(wrong.email);
    expect(logOutput).not.toContain("malformed-phc");
  }, 30_000);

  it("distinguishes malformed transport input with a safe 400", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      body: { email: "not-an-email", password: PASSWORD },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_REQUEST",
      message: "La solicitud no es válida.",
    });
  });

  it("fails closed for missing or untrusted login provenance and permits trusted Referer fallback", async () => {
    const identity = await createIdentity();
    for (const origin of [null, "https://app.bcm.test.evil"]) {
      const response = await request("/api/auth/login", {
        method: "POST",
        origin,
        body: { email: identity.email, password: PASSWORD },
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "ORIGIN_VALIDATION_FAILED",
      });
    }
    expect(
      (
        await request("/api/auth/login", {
          method: "POST",
          origin: null,
          referer: "https://app.bcm.test/login",
          body: { email: identity.email, password: PASSWORD },
        })
      ).status,
    ).toBe(204);
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
    const loginResponse = await login(identity.email);
    const setCookie = loginResponse.headers.get("set-cookie");
    if (setCookie === null) throw new Error("Login cookie was not issued.");
    const cookie = cookiePair(setCookie);

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
      const response = await login(identity.email);
      const setCookie = response.headers.get("set-cookie");
      if (setCookie === null) throw new Error("Login cookie was not issued.");
      cookies.push(cookiePair(setCookie));
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
    const loginResponse = await login(identity.email);
    const issued = loginResponse.headers.get("set-cookie");
    if (issued === null) throw new Error("Login cookie was not issued.");
    const cookie = cookiePair(issued);

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
    const loginResponse = await login(identity.email);
    const issued = loginResponse.headers.get("set-cookie");
    if (issued === null) throw new Error("Login cookie was not issued.");
    const cookie = cookiePair(issued);
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
    const firstLogin = await login(identity.email);
    const firstSetCookie = firstLogin.headers.get("set-cookie");
    if (firstSetCookie === null)
      throw new Error("First login cookie was not issued.");
    const firstCookie = cookiePair(firstSetCookie);
    const firstBootstrap = (await (
      await request("/api/auth/session", { cookie: firstCookie })
    ).json()) as { csrfToken: string };

    const secondLogin = await login(identity.email);
    const secondSetCookie = secondLogin.headers.get("set-cookie");
    if (secondSetCookie === null)
      throw new Error("Second login cookie was not issued.");
    const secondCookie = cookiePair(secondSetCookie);
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

  it("rehashes an outdated PHC without changing password_changed_at", async () => {
    const outdatedHash = await argon2Hash(Buffer.from(PASSWORD, "utf8"), {
      type: argon2id,
      memoryCost: 12_288,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
    const identity = await createIdentity({ passwordHash: outdatedHash });

    expect((await login(identity.email)).status).toBe(204);
    const credential = await fixtureSql.query<{
      password_changed_at: Date;
      password_hash: string;
    }>(
      `SELECT password_hash, password_changed_at
       FROM user_password_credentials
       WHERE user_id = $1::uuid`,
      [identity.userId],
    );
    expect(credential.rows[0]?.password_hash).not.toBe(outdatedHash);
    expect(credential.rows[0]?.password_changed_at).toEqual(
      identity.passwordChangedAt,
    );
  }, 30_000);

  it("does not overwrite or authenticate after a real PostgreSQL rehash race", async () => {
    const outdatedHash = await argon2Hash(Buffer.from(PASSWORD, "utf8"), {
      type: argon2id,
      memoryCost: 12_288,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
    const concurrentHash = await hasher.hash(OTHER_PASSWORD);
    const identity = await createIdentity({ passwordHash: outdatedHash });
    const delegate = new PrismaCredentialRepository(raceLifecycle.client);
    let releaseCas: (() => void) | undefined;
    let announceCas: (() => void) | undefined;
    const casReached = new Promise<void>((resolve) => {
      announceCas = resolve;
    });
    const casReleased = new Promise<void>((resolve) => {
      releaseCas = resolve;
    });
    const racingRepository: CredentialRepository = {
      findPasswordIdentityByNormalizedEmail: (email) =>
        delegate.findPasswordIdentityByNormalizedEmail(email),
      replacePasswordHashIfCurrent: async (input) => {
        announceCas?.();
        await casReleased;
        return delegate.replacePasswordHashIfCurrent(input);
      },
    };
    const audit: IdentityAudit = {
      recordLoginSucceeded: () => undefined,
      recordLoginFailed: () => undefined,
      recordLogout: () => undefined,
      recordOriginRejected: () => undefined,
      recordCsrfRejected: () => undefined,
      recordLoginRateLimited: () => undefined,
    };
    const clock = new SystemClock();
    const sessions = new SessionService(
      new PrismaSessionRepository(raceLifecycle.client),
      new NodeSessionTokenService(),
      clock,
      generateUuidV7,
      config.session,
    );
    const useCase = new LoginUseCase(
      racingRepository,
      new CredentialAuthenticator(hasher),
      hasher,
      sessions,
      clock,
      audit,
      new PersistentLoginRateLimiter(
        new PrismaLoginRateLimitStore(raceLifecycle.client),
        new NodeRateLimitFingerprint(config.security.rateLimitHmacKey),
        clock,
        config.security.loginRateLimits,
      ),
    );
    const loginAttempt = useCase.execute({
      email: identity.email,
      password: PASSWORD,
      clientIp: "127.0.0.1",
    });

    await casReached;
    await fixtureSql.query(
      `UPDATE user_password_credentials
       SET password_hash = $2,
           password_changed_at = password_changed_at + interval '1 millisecond',
           updated_at = updated_at + interval '1 millisecond'
       WHERE user_id = $1::uuid`,
      [identity.userId, concurrentHash],
    );
    releaseCas?.();

    await expect(loginAttempt).resolves.toEqual({ status: "invalid" });
    const persisted = await fixtureSql.query<{ password_hash: string }>(
      "SELECT password_hash FROM user_password_credentials WHERE user_id = $1::uuid",
      [identity.userId],
    );
    expect(persisted.rows[0]?.password_hash).toBe(concurrentHash);
    expect(
      await raceLifecycle.client.session.count({
        where: { userId: identity.userId },
      }),
    ).toBe(0);
  }, 30_000);

  it("returns the same 429 contract for known and unknown identities and ignores forwarded IP", async () => {
    const known = await createIdentity();
    for (const email of [known.email, "unknown-rate-limit@auth.test"]) {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        response = await request("/api/auth/login", {
          method: "POST",
          forwardedFor: `203.0.113.${attempt + 1}`,
          forwarded: `for=198.51.100.${attempt + 1}`,
          realIp: `192.0.2.${attempt + 1}`,
          body: { email, password: OTHER_PASSWORD },
        });
      }
      if (response === null)
        throw new Error("Rate-limit request was not executed.");
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      await expect(response.json()).resolves.toMatchObject({
        code: "TOO_MANY_REQUESTS",
        message: "Demasiados intentos. Intentá nuevamente más tarde.",
      });
    }
  }, 30_000);
});
