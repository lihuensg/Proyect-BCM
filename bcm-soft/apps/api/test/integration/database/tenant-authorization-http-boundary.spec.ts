import "reflect-metadata";

import { Writable } from "node:stream";

import {
  Controller,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Prisma } from "../../../src/generated/prisma/client.js";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AppModule } from "../../../src/app.module.js";
import { Argon2PasswordHasher } from "../../../src/identity/infrastructure/argon2-password-hasher.js";
import { CredentialAuthenticator } from "../../../src/identity/application/credential-authenticator.js";
import { PrismaSessionRepository } from "../../../src/identity/infrastructure/prisma-session-repository.js";
import { PrismaSessionAuthorizationSnapshot } from "../../../src/tenancy/infrastructure/prisma-session-authorization-snapshot.js";
import { ORGANIZATION_AUTHORITY_LOCK_NAMESPACE } from "../../../src/tenancy/infrastructure/prisma-tenant-persistence-scope.js";
import { configureCors } from "../../../src/config/cors.js";
import { loadServerConfig } from "../../../src/config/server-config.js";
import { NodeSessionTokenService } from "../../../src/identity/infrastructure/node-session-token-service.js";
import { SystemClock } from "../../../src/identity/infrastructure/system-clock.js";
import { SessionCookieCodec } from "../../../src/identity/presentation/session-cookie-codec.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import {
  configureObservability,
  createObservability,
} from "../../../src/observability/observability.js";
import { SafeHttpException } from "../../../src/observability/safe-http-exception.js";
import {
  definePermissionRequirement,
  type MembershipRole,
} from "../../../src/tenancy/application/authorization.js";
import type { TenantContext } from "../../../src/tenancy/application/tenant-authority.js";
import {
  TenantPersistenceError,
  type TenantPersistenceScope,
  type TenantRepositoryScopeLease,
} from "../../../src/tenancy/application/tenant-persistence-scope.js";
import { PrismaTenantPersistenceScope } from "../../../src/tenancy/infrastructure/prisma-tenant-persistence-scope.js";
import { TenantAuthorizationHttpMapper } from "../../../src/tenancy/presentation/tenant-authorization-http-mapper.js";
import { TenantAuthorityGuard } from "../../../src/tenancy/presentation/tenant-authority.guard.js";
import { CurrentTenant } from "../../../src/tenancy/presentation/tenant-request-context.js";

type MembershipStatus = "Active" | "Suspended" | "Revoked";

type AuthenticatedTenantFixture = Readonly<{
  cookie: string;
  membershipId: string;
  organizationId: string;
  sessionId: string;
  userId: string;
}>;

type ProbeReadResult =
  | Readonly<{ status: "found"; value: string }>
  | Readonly<{ status: "not-found" }>;

type AuthorizationProbeRepositories = Readonly<{
  probes: Readonly<{
    findById(resourceId: string): Promise<ProbeReadResult>;
  }>;
}>;

type SessionState = Readonly<{
  createdAt: Date;
  currentMembershipAuthorizationVersion: string;
  currentOrganizationId: string;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  tokenHash: string;
}>;

const config = loadServerConfig({
  ...process.env,
  NODE_ENV: "test",
  PORT: "0",
});
const logChunks: string[] = [];
const observability = createObservability(config, {
  destination: new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      logChunks.push(chunk.toString("utf8"));
      callback();
    },
  }),
  level: "debug",
});
const authorizationLifecycle = new PrismaClientLifecycle(
  config.database.runtimeUrl,
);
const tokens = new NodeSessionTokenService();
const cookies = new SessionCookieCodec(config.sessionCookie, tokens);
const PASSWORD = "  renovación explícita 🔐  ";
const hasher = new Argon2PasswordHasher();
let passwordHash: string;
const MANAGE_MEMBERSHIPS = definePermissionRequirement("memberships.manage");
const TEST_AUTHORIZATION_SCOPE = Symbol("TestAuthorizationScope");

function createProbeRepositories(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  lease: TenantRepositoryScopeLease,
): AuthorizationProbeRepositories {
  return Object.freeze({
    probes: Object.freeze({
      findById: async (resourceId: string): Promise<ProbeReadResult> => {
        lease.assertActive();
        const rows = await transaction.$queryRaw<Array<{ found: number }>>`
          SELECT 1 AS found
          FROM organization_memberships AS membership
          WHERE membership.organization_id = ${organizationId}::uuid
            AND membership.id = ${resourceId}::uuid
          LIMIT 2
        `;
        if (rows.length > 1) {
          throw new TenantPersistenceError(
            new Error("The authorization HTTP probe returned duplicate rows."),
          );
        }
        const row = rows[0];
        return row === undefined
          ? Object.freeze({ status: "not-found" })
          : Object.freeze({ status: "found", value: "available" });
      },
    }),
  });
}

const authorizationScope = new PrismaTenantPersistenceScope(
  authorizationLifecycle.client,
  new SystemClock(),
  config.session.idleTimeoutMilliseconds,
  createProbeRepositories,
);

class ReadAuthorizationProbeUseCase {
  constructor(
    private readonly persistence: TenantPersistenceScope<AuthorizationProbeRepositories>,
  ) {}

  execute(
    tenantContext: TenantContext,
    input: Readonly<{ resourceId: string }>,
  ) {
    return this.persistence.runAuthorized(
      tenantContext,
      MANAGE_MEMBERSHIPS,
      ({ repositories }) => repositories.probes.findById(input.resourceId),
    );
  }
}

function resourceNotFound(): SafeHttpException {
  return new SafeHttpException(
    404,
    "RESOURCE_NOT_FOUND",
    "El recurso no est\u00e1 disponible.",
  );
}

class TenantAuthorizationTestController {
  constructor(
    private readonly useCase: ReadAuthorizationProbeUseCase,
    private readonly mapper: TenantAuthorizationHttpMapper,
  ) {}

  async execute(
    tenantContext: TenantContext,
    resourceId: string,
  ): Promise<Extract<ProbeReadResult, { status: "found" }>> {
    const result = this.mapper.map(
      await this.useCase.execute(tenantContext, { resourceId }),
    );
    if (result.status === "not-found") throw resourceNotFound();
    return result;
  }
}

class AuthorizationConfigurationFailureTestController {
  constructor(private readonly mapper: TenantAuthorizationHttpMapper) {}

  execute(tenantContext: TenantContext): never {
    void tenantContext;
    return this.mapper.map<never>({
      status: "authorization-denied",
      reason: "invalid-permission-requirement",
    });
  }
}

Inject(TEST_AUTHORIZATION_SCOPE)(ReadAuthorizationProbeUseCase, undefined, 0);
Injectable()(ReadAuthorizationProbeUseCase);
Inject(ReadAuthorizationProbeUseCase)(
  TenantAuthorizationTestController,
  undefined,
  0,
);
Inject(TenantAuthorizationHttpMapper)(
  TenantAuthorizationTestController,
  undefined,
  1,
);
const executeDescriptor = Object.getOwnPropertyDescriptor(
  TenantAuthorizationTestController.prototype,
  "execute",
);
if (executeDescriptor === undefined) {
  throw new Error("The test-only authorization handler is unavailable.");
}
CurrentTenant()(TenantAuthorizationTestController.prototype, "execute", 0);
Param("resourceId")(TenantAuthorizationTestController.prototype, "execute", 1);
Post(":resourceId")(
  TenantAuthorizationTestController.prototype,
  "execute",
  executeDescriptor,
);
UseGuards(TenantAuthorityGuard)(
  TenantAuthorizationTestController.prototype,
  "execute",
  executeDescriptor,
);
Controller("test-only/tenant-authorization")(TenantAuthorizationTestController);

Inject(TenantAuthorizationHttpMapper)(
  AuthorizationConfigurationFailureTestController,
  undefined,
  0,
);
const configurationFailureDescriptor = Object.getOwnPropertyDescriptor(
  AuthorizationConfigurationFailureTestController.prototype,
  "execute",
);
if (configurationFailureDescriptor === undefined) {
  throw new Error(
    "The test-only authorization configuration handler is unavailable.",
  );
}
CurrentTenant()(
  AuthorizationConfigurationFailureTestController.prototype,
  "execute",
  0,
);
Post("invalid-requirement")(
  AuthorizationConfigurationFailureTestController.prototype,
  "execute",
  configurationFailureDescriptor,
);
UseGuards(TenantAuthorityGuard)(
  AuthorizationConfigurationFailureTestController.prototype,
  "execute",
  configurationFailureDescriptor,
);
Controller("test-only/authorization-configuration")(
  AuthorizationConfigurationFailureTestController,
);

// Nest metadata is applied without decorator syntax because the integration
// test transform does not support parameter decorators outside the source tree.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class TenantAuthorizationTestModule {}
Module({
  imports: [AppModule.register(config, observability.logger)],
  controllers: [
    TenantAuthorizationTestController,
    AuthorizationConfigurationFailureTestController,
  ],
  providers: [
    ReadAuthorizationProbeUseCase,
    { provide: TEST_AUTHORIZATION_SCOPE, useValue: authorizationScope },
    {
      provide: TenantAuthorizationHttpMapper,
      useFactory: () => new TenantAuthorizationHttpMapper(observability.logger),
    },
  ],
})(TenantAuthorizationTestModule);

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

describe("Application/HTTP authorization boundary with PostgreSQL", () => {
  const fixtureSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });
  const monitorSql = new Client({
    connectionString: process.env.BCM_TEST_ADMIN_DATABASE_URL,
  });
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;

  async function createUser(): Promise<string> {
    const userId = generateUuidV7();
    const email = `${userId}@authorization-http.test`;
    const now = new Date();
    await fixtureSql.query(
      `INSERT INTO users
        (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $2, 'Active', $3, $3)`,
      [userId, email, now],
    );
    await fixtureSql.query(
      `INSERT INTO user_password_credentials (user_id, password_hash, password_changed_at, created_at, updated_at) VALUES ($1::uuid, $2, $3, $3, $3)`,
      [userId, passwordHash, now],
    );
    return userId;
  }

  async function createOrganization(): Promise<string> {
    const organizationId = generateUuidV7();
    const now = new Date();
    await fixtureSql.query(
      `INSERT INTO organizations
        (id, name, status, timezone, created_at, updated_at)
       VALUES ($1::uuid, $2, 'Active', 'America/Argentina/Buenos_Aires', $3, $3)`,
      [organizationId, `Organization ${organizationId}`, now],
    );
    return organizationId;
  }

  async function createMembership(
    userId: string,
    organizationId: string,
    role: MembershipRole,
    status: MembershipStatus,
    authorizationVersion: bigint,
  ): Promise<string> {
    const membershipId = generateUuidV7();
    const now = new Date();
    await fixtureSql.query(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, authorization_version,
         activated_at, revoked_at, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
               $7, $8, $7, $7)`,
      [
        membershipId,
        organizationId,
        userId,
        role,
        status,
        authorizationVersion,
        now,
        status === "Revoked" ? now : null,
      ],
    );
    return membershipId;
  }

  async function createSession(
    userId: string,
    organizationId: string,
    authorizationVersion: bigint,
  ): Promise<Readonly<{ cookie: string; sessionId: string }>> {
    const rawToken = tokens.generate();
    const sessionId = generateUuidV7();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + config.session.absoluteLifetimeMilliseconds,
    );
    await fixtureSql.query(
      `INSERT INTO sessions
        (id, token_hash, user_id, current_organization_id,
         current_membership_authorization_version, expires_at, revoked_at,
         last_seen_at, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, NULL, $7, $7)`,
      [
        sessionId,
        tokens.digest(rawToken),
        userId,
        organizationId,
        authorizationVersion,
        expiresAt,
        now,
      ],
    );
    return Object.freeze({
      cookie: cookiePair(cookies.serialize(rawToken, expiresAt)),
      sessionId,
    });
  }

  async function createTenantFixture(
    input: Readonly<{
      membershipStatus?: MembershipStatus;
      membershipVersion?: bigint;
      role?: MembershipRole;
      sessionVersion?: bigint;
    }> = {},
  ): Promise<AuthenticatedTenantFixture> {
    const userId = await createUser();
    const organizationId = await createOrganization();
    const membershipVersion = input.membershipVersion ?? 1n;
    const membershipId = await createMembership(
      userId,
      organizationId,
      input.role ?? "Admin",
      input.membershipStatus ?? "Active",
      membershipVersion,
    );
    const session = await createSession(
      userId,
      organizationId,
      input.sessionVersion ?? membershipVersion,
    );
    return Object.freeze({
      cookie: session.cookie,
      membershipId,
      organizationId,
      sessionId: session.sessionId,
      userId,
    });
  }

  async function readSessionState(sessionId: string): Promise<SessionState> {
    const state = await fixtureSql.query<SessionState>(
      `SELECT
         encode(token_hash, 'hex') AS "tokenHash",
         current_organization_id::text AS "currentOrganizationId",
         current_membership_authorization_version::text
           AS "currentMembershipAuthorizationVersion",
         expires_at AS "expiresAt",
         revoked_at AS "revokedAt",
         last_seen_at AS "lastSeenAt",
         created_at AS "createdAt"
       FROM sessions
       WHERE id = $1::uuid`,
      [sessionId],
    );
    const row = state.rows[0];
    if (row === undefined) throw new Error("The test Session is missing.");
    return row;
  }

  async function request(
    path: string,
    input: Readonly<{
      authorizationVersion?: string;
      body?: unknown;
      cookie?: string;
      permission?: string;
      role?: string;
      csrfToken?: string;
      origin?: string;
    }> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (input.csrfToken !== undefined)
      headers["x-csrf-token"] = input.csrfToken;
    if (input.origin !== undefined) headers.origin = input.origin;
    if (input.cookie !== undefined) headers.cookie = input.cookie;
    if (input.body !== undefined) headers["content-type"] = "application/json";
    if (input.role !== undefined) headers["x-role"] = input.role;
    if (input.permission !== undefined)
      headers["x-permission"] = input.permission;
    if (input.authorizationVersion !== undefined) {
      headers["x-authorization-version"] = input.authorizationVersion;
    }

    return fetch(`${baseUrl}${path}`, {
      method: path === "/api/auth/session" ? "GET" : "POST",
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  }

  async function expectSafeError(
    response: Response,
    status: number,
    code: string,
    details?: Readonly<{ authorizationState: "stale" }>,
  ): Promise<Readonly<Record<string, unknown>>> {
    expect(response.status).toBe(status);
    const body = (await response.json()) as Readonly<Record<string, unknown>>;
    expect(body).toEqual({
      statusCode: status,
      code,
      message: expect.any(String),
      requestId: expect.any(String),
      ...(details === undefined ? {} : { details }),
    });
    expect(JSON.stringify(body)).not.toMatch(
      /membershipId|organizationId|requiredPermission|authorizationVersion|stack/iu,
    );
    return body;
  }

  async function expectIdentityOnly(
    cookie: string,
    userId: string,
  ): Promise<void> {
    const response = await request("/api/auth/session", { cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "authenticated",
      "csrfToken",
      "user",
    ]);
    expect(body.authenticated).toBe(true);
    expect(body.user).toEqual({ id: userId });
    expect(JSON.stringify(body)).not.toMatch(
      /role|permissions|organizationId|membershipId|authorizationVersion|stale/iu,
    );
  }

  beforeAll(async () => {
    passwordHash = await hasher.hash(PASSWORD);
    await monitorSql.connect();
    await fixtureSql.connect();
    await authorizationLifecycle.connect();
  }, 30_000);

  beforeEach(async () => {
    if (app !== undefined) await app.close();
    // Real limiter state is isolated per test; production thresholds are kept.
    await fixtureSql.query("DELETE FROM identity_rate_limit_windows");
    app = await NestFactory.create(TenantAuthorizationTestModule, {
      abortOnError: false,
      logger: observability.logger,
    });
    app.setGlobalPrefix("api");
    configureCors(app, config);
    configureObservability(app, observability);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    logChunks.length = 0;
  }, 30_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await authorizationLifecycle.disconnect();
    await fixtureSql.end();
    await monitorSql.end();
  });

  it("keeps missing Authentication as 401 AUTHENTICATION_REQUIRED", async () => {
    await expectSafeError(
      await request(`/api/test-only/tenant-authorization/${generateUuidV7()}`),
      401,
      "AUTHENTICATION_REQUIRED",
    );
  });

  async function csrf(cookie: string): Promise<string> {
    const response = await request("/api/auth/session", { cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { csrfToken: string };
    return body.csrfToken;
  }

  async function renew(cookie: string, password = PASSWORD): Promise<Response> {
    return request("/api/auth/session/renew", {
      cookie,
      csrfToken: await csrf(cookie),
      origin: "https://app.bcm.test",
      body: { password },
    });
  }

  function replacementCookie(response: Response): string {
    expect(response.status).toBe(204);
    const value = response.headers.get("set-cookie");
    if (value === null) throw new Error("Replacement cookie missing.");
    expect(value).toContain("HttpOnly");
    expect(value).toContain("SameSite=Lax");
    expect(value).toContain("Path=/");
    expect(value).not.toContain("Domain=");
    return cookiePair(value);
  }

  async function sessionsFor(userId: string) {
    return (
      await fixtureSql.query<{
        id: string;
        revokedAt: Date | null;
        organizationId: string | null;
        version: string | null;
      }>(
        `SELECT id, revoked_at AS "revokedAt", current_organization_id AS "organizationId", current_membership_authorization_version::text AS version FROM sessions WHERE user_id = $1::uuid ORDER BY created_at, id`,
        [userId],
      )
    ).rows;
  }

  it.each([undefined, "bcm_session=invalid", `bcm_session=${"A".repeat(43)}`])(
    "renew requires a currently authenticated Session",
    async (cookie) => {
      const response = await request("/api/auth/session/renew", {
        ...(cookie === undefined ? {} : { cookie }),
        origin: "https://app.bcm.test",
        body: { password: PASSWORD },
      });
      await expectSafeError(response, 401, "AUTHENTICATION_REQUIRED");
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it.each(["missing-csrf", "wrong-csrf", "wrong-origin"])(
    "rejects renewal with %s without replacement",
    async (failure) => {
      const f = await createTenantFixture({
        sessionVersion: 5n,
        membershipVersion: 6n,
      });
      const before = await readSessionState(f.sessionId);
      const response = await request("/api/auth/session/renew", {
        cookie: f.cookie,
        origin:
          failure === "wrong-origin"
            ? "https://evil.test"
            : "https://app.bcm.test",
        ...(failure === "missing-csrf"
          ? {}
          : {
              csrfToken:
                failure === "wrong-csrf" ? "invalid" : await csrf(f.cookie),
            }),
        body: { password: PASSWORD },
      });
      await expectSafeError(
        response,
        403,
        failure === "wrong-origin"
          ? "ORIGIN_VALIDATION_FAILED"
          : "CSRF_VALIDATION_FAILED",
      );
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await readSessionState(f.sessionId)).toEqual(before);
      expect(await sessionsFor(f.userId)).toHaveLength(1);
    },
  );

  it.each([
    "email",
    "userId",
    "sessionId",
    "organizationId",
    "membershipId",
    "role",
    "permission",
    "authorizationVersion",
    "token",
    "currentTenant",
    "targetTenant",
  ])("rejects client-supplied %s on renewal", async (field) => {
    const f = await createTenantFixture();
    const response = await request("/api/auth/session/renew", {
      cookie: f.cookie,
      origin: "https://app.bcm.test",
      csrfToken: await csrf(f.cookie),
      body: { password: PASSWORD, [field]: "untrusted" },
    });
    await expectSafeError(response, 400, "INVALID_REQUEST");
    expect(await sessionsFor(f.userId)).toHaveLength(1);
  });

  it.each([
    "wrong password with sufficient length",
    PASSWORD.trim(),
    PASSWORD.normalize("NFD"),
  ])(
    "fails generically without changing the old Session for an unproven password",
    async (password) => {
      const f = await createTenantFixture({
        sessionVersion: 5n,
        membershipVersion: 6n,
      });
      const before = await readSessionState(f.sessionId);
      const response = await renew(f.cookie, password);
      await expectSafeError(response, 401, "INVALID_CREDENTIALS");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await readSessionState(f.sessionId)).toEqual(before);
      expect(await sessionsFor(f.userId)).toHaveLength(1);
      await expectIdentityOnly(f.cookie, f.userId);
    },
  );

  it.each(["Viewer", "Admin"] as const)(
    "replaces stale authority with current %s permissions only after password proof",
    async (role) => {
      const f = await createTenantFixture({
        sessionVersion: 5n,
        membershipVersion: 5n,
        role: role === "Viewer" ? "Admin" : "Viewer",
      });
      await fixtureSql.query(
        "UPDATE organization_memberships SET role = $2, authorization_version = 6 WHERE id = $1::uuid",
        [f.membershipId, role],
      );
      const organizationB = await createOrganization();
      await createMembership(f.userId, organizationB, "Admin", "Active", 8n);
      await expectSafeError(
        await request(`/api/test-only/tenant-authorization/${f.membershipId}`, {
          cookie: f.cookie,
        }),
        403,
        "AUTHORIZATION_DENIED",
        { authorizationState: "stale" },
      );
      const oldCsrf = await csrf(f.cookie);
      const before = await readSessionState(f.sessionId);
      const response = await renew(f.cookie);
      const cookie = replacementCookie(response);
      expect(await response.text()).toBe("");
      expect(cookie).not.toBe(f.cookie);
      const rows = await sessionsFor(f.userId);
      expect(rows).toHaveLength(2);
      const current = rows.find((row) => row.id !== f.sessionId);
      expect(current).toMatchObject({
        revokedAt: null,
        organizationId: f.organizationId,
        version: "6",
      });
      if (current === undefined) throw new Error("New Session is missing.");
      const newState = await readSessionState(current.id);
      expect(newState.tokenHash).not.toBe(before.tokenHash);
      expect(newState.createdAt.getTime()).toBeGreaterThan(
        before.createdAt.getTime(),
      );
      expect(newState.lastSeenAt).toEqual(newState.createdAt);
      expect(newState.expiresAt.getTime() - newState.createdAt.getTime()).toBe(
        config.session.absoluteLifetimeMilliseconds,
      );
      expect(await readSessionState(f.sessionId)).toEqual({
        ...before,
        revokedAt: expect.any(Date),
      });
      await expectSafeError(
        await request("/api/auth/session", { cookie: f.cookie }),
        401,
        "AUTHENTICATION_REQUIRED",
      );
      await expectIdentityOnly(cookie, f.userId);
      const business = await request(
        `/api/test-only/tenant-authorization/${f.membershipId}`,
        { cookie },
      );
      if (role === "Admin") expect(business.status).toBe(201);
      else await expectSafeError(business, 403, "AUTHORIZATION_DENIED");
      const newCsrf = await csrf(cookie);
      expect(newCsrf).not.toBe(oldCsrf);
      await expectSafeError(
        await request("/api/auth/session/renew", {
          cookie,
          origin: "https://app.bcm.test",
          csrfToken: oldCsrf,
          body: { password: PASSWORD },
        }),
        403,
        "CSRF_VALIDATION_FAILED",
      );
      const fresh = await request("/api/auth/session/renew", {
        cookie,
        origin: "https://app.bcm.test",
        csrfToken: newCsrf,
        body: { password: PASSWORD },
      });
      replacementCookie(fresh);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const logs = logChunks.join("");
      expect(logs).toContain("session.renewal.succeeded");
      for (const secret of [
        PASSWORD,
        passwordHash,
        cookie,
        f.cookie,
        oldCsrf,
        newCsrf,
      ])
        expect(logs).not.toContain(secret);
    },
  );

  it.each(["Suspended", "Revoked", "Inactive", "no-selection"])(
    "clears or preserves NULL for %s without selecting a valid B",
    async (state) => {
      const f = await createTenantFixture();
      const organizationB = await createOrganization();
      await createMembership(f.userId, organizationB, "Admin", "Active", 7n);
      if (state === "Inactive")
        await fixtureSql.query(
          "UPDATE organizations SET status = 'Inactive' WHERE id = $1::uuid",
          [f.organizationId],
        );
      else if (state === "no-selection")
        await fixtureSql.query(
          "UPDATE sessions SET current_organization_id = NULL, current_membership_authorization_version = NULL WHERE id = $1::uuid",
          [f.sessionId],
        );
      else
        await fixtureSql.query(
          "UPDATE organization_memberships SET status = $2, revoked_at = CASE WHEN $2 = 'Revoked' THEN created_at + interval '1 millisecond' ELSE NULL END WHERE id = $1::uuid",
          [f.membershipId, state],
        );
      const cookie = replacementCookie(await renew(f.cookie));
      const rows = await sessionsFor(f.userId);
      expect(rows.find((row) => row.id !== f.sessionId)).toMatchObject({
        organizationId: null,
        version: null,
        revokedAt: null,
      });
      await expectIdentityOnly(cookie, f.userId);
    },
  );

  it("renews a non-stale Session and leaves the other stale Sessions untouched", async () => {
    const f = await createTenantFixture({ membershipVersion: 6n });
    const b = await createSession(f.userId, f.organizationId, 5n);
    const c = await createSession(f.userId, f.organizationId, 5n);
    const beforeB = await readSessionState(b.sessionId);
    const beforeC = await readSessionState(c.sessionId);
    replacementCookie(await renew(f.cookie));
    expect(await readSessionState(b.sessionId)).toEqual(beforeB);
    expect(await readSessionState(c.sessionId)).toEqual(beforeC);
    for (const other of [b, c])
      await expectSafeError(
        await request(`/api/test-only/tenant-authorization/${f.membershipId}`, {
          cookie: other.cookie,
        }),
        403,
        "AUTHORIZATION_DENIED",
        { authorizationState: "stale" },
      );
  });

  function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it("permits exactly one concurrent replacement of the same authenticated Session", async () => {
    const f = await createTenantFixture({
      sessionVersion: 5n,
      membershipVersion: 6n,
    });
    const csrfToken = await csrf(f.cookie);
    const authenticator = app.get(CredentialAuthenticator);
    const original = authenticator.authenticate.bind(authenticator);
    const bothVerified = deferred();
    let verified = 0;
    const spy = vi
      .spyOn(authenticator, "authenticate")
      .mockImplementation(async (input) => {
        const result = await original(input);
        verified += 1;
        if (verified === 2) bothVerified.resolve();
        await bothVerified.promise;
        return result;
      });
    try {
      const responses = await Promise.all(
        [1, 2].map(() =>
          request("/api/auth/session/renew", {
            cookie: f.cookie,
            csrfToken,
            origin: "https://app.bcm.test",
            body: { password: PASSWORD },
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([
        204, 401,
      ]);
      const loser = responses.find((response) => response.status === 401);
      if (loser === undefined)
        throw new Error("Expected one rejected replacement.");
      await expectSafeError(loser, 401, "AUTHENTICATION_REQUIRED");
      expect(loser.headers.get("set-cookie")).toBeNull();
      const rows = await sessionsFor(f.userId);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    } finally {
      bothVerified.resolve();
      spy.mockRestore();
    }
  }, 30_000);

  it.each(["password-changed", "user-disabled", "session-revoked"])(
    "fails closed when %s after password verification",
    async (change) => {
      const f = await createTenantFixture();
      const authenticator = app.get(CredentialAuthenticator);
      const original = authenticator.authenticate.bind(authenticator);
      const verified = deferred();
      const release = deferred();
      const spy = vi
        .spyOn(authenticator, "authenticate")
        .mockImplementationOnce(async (input) => {
          const result = await original(input);
          verified.resolve();
          await release.promise;
          return result;
        });
      const pending = renew(f.cookie);
      try {
        await verified.promise;
        if (change === "password-changed")
          await fixtureSql.query(
            "UPDATE user_password_credentials SET password_hash = $2, password_changed_at = created_at + interval '1 millisecond', updated_at = created_at + interval '1 millisecond' WHERE user_id = $1::uuid",
            [f.userId, await hasher.hash("a different current password")],
          );
        else if (change === "user-disabled")
          await fixtureSql.query(
            "UPDATE users SET status = 'Disabled' WHERE id = $1::uuid",
            [f.userId],
          );
        else
          await fixtureSql.query(
            "UPDATE sessions SET revoked_at = created_at + interval '1 millisecond' WHERE id = $1::uuid",
            [f.sessionId],
          );
        const before = await readSessionState(f.sessionId);
        release.resolve();
        const response = await pending;
        await expectSafeError(
          response,
          401,
          change === "session-revoked"
            ? "AUTHENTICATION_REQUIRED"
            : "INVALID_CREDENTIALS",
        );
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(await readSessionState(f.sessionId)).toEqual(before);
        expect(await sessionsFor(f.userId)).toHaveLength(1);
      } finally {
        release.resolve();
        await pending;
        spy.mockRestore();
      }
    },
  );

  it("rolls back new Session creation when the subsequent old revocation fails in PostgreSQL", async () => {
    const f = await createTenantFixture();
    const before = await readSessionState(f.sessionId);
    await fixtureSql.query(
      `CREATE FUNCTION test_renewal_revoke_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic renewal revoke failure'; END $$; CREATE TRIGGER test_renewal_revoke_failure BEFORE UPDATE OF revoked_at ON sessions FOR EACH ROW EXECUTE FUNCTION test_renewal_revoke_failure()`,
    );
    try {
      const response = await renew(f.cookie);
      await expectSafeError(response, 500, "INTERNAL_SERVER_ERROR");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await readSessionState(f.sessionId)).toEqual(before);
      expect(await sessionsFor(f.userId)).toHaveLength(1);
      await expectIdentityOnly(f.cookie, f.userId);
    } finally {
      await fixtureSql.query(
        "DROP TRIGGER test_renewal_revoke_failure ON sessions; DROP FUNCTION test_renewal_revoke_failure()",
      );
    }
  });

  it("limits password attempts persistently without revoking the Session", async () => {
    const f = await createTenantFixture();
    const csrfToken = await csrf(f.cookie);
    const before = await readSessionState(f.sessionId);
    const maximum = Math.min(
      config.security.loginRateLimits.identity.maximumAttempts,
      config.security.loginRateLimits.identityNetwork.maximumAttempts,
    );
    for (let attempt = 0; attempt <= maximum; attempt += 1) {
      const response = await request("/api/auth/session/renew", {
        cookie: f.cookie,
        csrfToken,
        origin: "https://app.bcm.test",
        body: { password: "an incorrect password long enough" },
      });
      if (attempt === maximum) {
        await expectSafeError(response, 429, "TOO_MANY_REQUESTS");
        expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      } else await expectSafeError(response, 401, "INVALID_CREDENTIALS");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(await readSessionState(f.sessionId)).toEqual(before);
    expect(await sessionsFor(f.userId)).toHaveLength(1);
    const other = await createSession(f.userId, f.organizationId, 1n);
    const otherBefore = await readSessionState(other.sessionId);
    // A second bearer for the same User cannot bypass the identity budget.
    const rejected = await renew(other.cookie);
    await expectSafeError(rejected, 429, "TOO_MANY_REQUESTS");
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(await readSessionState(other.sessionId)).toEqual(otherBefore);
    expect(await sessionsFor(f.userId)).toHaveLength(2);
  });

  async function waitForBlock(holderPid: number): Promise<void> {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const state = await monitorSql.query<{ blocked: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked",
        [holderPid],
      );
      if (state.rows[0]?.blocked === true) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(
      "The replacement did not wait on the held PostgreSQL lock.",
    );
  }

  it.each(["role", "Suspended", "Revoked", "organization"])(
    "observes a concurrent %s mutation that commits before its snapshot",
    async (mutation) => {
      const f = await createTenantFixture({
        sessionVersion: 5n,
        membershipVersion: 5n,
      });
      const csrfToken = await csrf(f.cookie);
      const pid = fixtureSql.processID;
      if (pid === undefined) throw new Error("Fixture backend is unavailable.");
      await fixtureSql.query("BEGIN");
      let pending: Promise<Response> | undefined;
      try {
        if (mutation === "organization") {
          await fixtureSql.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1::text || $2::text, 0))",
            [ORGANIZATION_AUTHORITY_LOCK_NAMESPACE, f.organizationId],
          );
          await fixtureSql.query(
            "UPDATE organizations SET status = 'Inactive' WHERE id = $1::uuid",
            [f.organizationId],
          );
        } else if (mutation === "role") {
          await fixtureSql.query(
            "UPDATE organization_memberships SET role = 'Viewer', authorization_version = 6 WHERE id = $1::uuid",
            [f.membershipId],
          );
        } else {
          await fixtureSql.query(
            "UPDATE organization_memberships SET status = $2, authorization_version = 6, revoked_at = CASE WHEN $2 = 'Revoked' THEN created_at + interval '1 millisecond' ELSE NULL END WHERE id = $1::uuid",
            [f.membershipId, mutation],
          );
        }
        pending = request("/api/auth/session/renew", {
          cookie: f.cookie,
          csrfToken,
          origin: "https://app.bcm.test",
          body: { password: PASSWORD },
        });
        await waitForBlock(pid);
        await fixtureSql.query("COMMIT");
        const cookie = replacementCookie(await pending);
        const current = (await sessionsFor(f.userId)).find(
          (row) => row.id !== f.sessionId,
        );
        expect(current).toMatchObject(
          mutation === "role"
            ? { organizationId: f.organizationId, version: "6" }
            : { organizationId: null, version: null },
        );
        await expectIdentityOnly(cookie, f.userId);
      } finally {
        await fixtureSql.query("ROLLBACK");
        if (pending !== undefined) await pending;
      }
    },
    30_000,
  );

  it.each(["role", "Suspended", "organization", "password"])(
    "commits a coherent replacement before a competing %s mutation when its locks win",
    async (mutation) => {
      const f = await createTenantFixture({
        sessionVersion: 5n,
        membershipVersion: 5n,
      });
      const locked = deferred();
      const release = deferred();
      const original =
        PrismaSessionAuthorizationSnapshot.prototype.resolveSelected;
      const spy = vi
        .spyOn(PrismaSessionAuthorizationSnapshot.prototype, "resolveSelected")
        .mockImplementationOnce(async function (userId, organizationId) {
          const snapshot = await original.call(this, userId, organizationId);
          locked.resolve();
          await release.promise;
          return snapshot;
        });
      const pending = renew(f.cookie);
      let mutationPending: Promise<unknown> | undefined;
      try {
        await locked.promise;
        await fixtureSql.query("BEGIN");
        if (mutation === "organization")
          mutationPending = fixtureSql.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1::text || $2::text, 0))",
            [ORGANIZATION_AUTHORITY_LOCK_NAMESPACE, f.organizationId],
          );
        else if (mutation === "password")
          mutationPending = fixtureSql.query(
            "UPDATE user_password_credentials SET password_hash = $2 WHERE user_id = $1::uuid",
            [f.userId, await hasher.hash("a changed current password")],
          );
        else if (mutation === "role")
          mutationPending = fixtureSql.query(
            "UPDATE organization_memberships SET role = 'Viewer', authorization_version = 6 WHERE id = $1::uuid",
            [f.membershipId],
          );
        else
          mutationPending = fixtureSql.query(
            "UPDATE organization_memberships SET status = 'Suspended', authorization_version = 6 WHERE id = $1::uuid",
            [f.membershipId],
          );
        const deadline = Date.now() + 4_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const state = await monitorSql.query<{ blocked: boolean }>(
            "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
            [fixtureSql.processID],
          );
          if (state.rows[0]?.blocked === true) {
            blocked = true;
            break;
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        expect(blocked).toBe(true);
        release.resolve();
        const cookie = replacementCookie(await pending);
        await mutationPending;
        if (mutation === "organization")
          await fixtureSql.query(
            "UPDATE organizations SET status = 'Inactive' WHERE id = $1::uuid",
            [f.organizationId],
          );
        await fixtureSql.query("COMMIT");
        expect(
          (await sessionsFor(f.userId)).find((row) => row.id !== f.sessionId),
        ).toMatchObject({ organizationId: f.organizationId, version: "5" });
        if (mutation !== "password") {
          await expectSafeError(
            await request(
              `/api/test-only/tenant-authorization/${f.membershipId}`,
              { cookie },
            ),
            403,
            mutation === "role"
              ? "AUTHORIZATION_DENIED"
              : "TENANT_ACCESS_DENIED",
            mutation === "role" ? { authorizationState: "stale" } : undefined,
          );
        }
      } finally {
        release.resolve();
        await pending;
        if (mutationPending !== undefined) await mutationPending;
        await fixtureSql.query("ROLLBACK");
        spy.mockRestore();
      }
    },
    30_000,
  );

  it.each(["absolute", "idle", "different-user", "different-token"])(
    "rechecks old Session %s inside the replacement transaction",
    async (invalid) => {
      const f = await createTenantFixture();
      const rawToken = cookies.parse(f.cookie);
      if (rawToken === null) throw new Error("Fixture cookie invalid.");
      if (invalid === "absolute")
        await fixtureSql.query(
          "UPDATE sessions SET created_at = now() - interval '2 days', last_seen_at = now() - interval '1 day', expires_at = now() - interval '1 hour' WHERE id = $1::uuid",
          [f.sessionId],
        );
      if (invalid === "idle")
        await fixtureSql.query(
          "UPDATE sessions SET created_at = now() - interval '2 days', last_seen_at = now() - interval '1 day' WHERE id = $1::uuid",
          [f.sessionId],
        );
      const before = await readSessionState(f.sessionId);
      const repository = new PrismaSessionRepository(
        authorizationLifecycle.client,
        (transaction) => new PrismaSessionAuthorizationSnapshot(transaction),
      );
      const now = new Date();
      const result = await repository.replace({
        sessionId: f.sessionId,
        userId: invalid === "different-user" ? generateUuidV7() : f.userId,
        tokenHash: tokens.digest(
          invalid === "different-token" ? tokens.generate() : rawToken,
        ),
        verifiedPasswordHash: passwordHash,
        idleTimeoutMilliseconds: config.session.idleTimeoutMilliseconds,
        replacement: {
          id: generateUuidV7(),
          userId: f.userId,
          tokenHash: tokens.digest(tokens.generate()),
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(
            now.getTime() + config.session.absoluteLifetimeMilliseconds,
          ),
        },
      });
      expect(result).toEqual({ status: "authentication-required" });
      expect(await readSessionState(f.sessionId)).toEqual(before);
      expect(await sessionsFor(f.userId)).toHaveLength(1);
    },
  );

  it("keeps invalid tenant authority as 403 TENANT_ACCESS_DENIED", async () => {
    const fixture = await createTenantFixture({
      membershipStatus: "Suspended",
    });

    await expectSafeError(
      await request(`/api/test-only/tenant-authorization/${generateUuidV7()}`, {
        cookie: fixture.cookie,
      }),
      403,
      "TENANT_ACCESS_DENIED",
    );
  });

  it("executes an allowed fixed requirement inside the authorized persistence scope", async () => {
    const fixture = await createTenantFixture({ role: "Admin" });

    const response = await request(
      `/api/test-only/tenant-authorization/${fixture.membershipId}`,
      { cookie: fixture.cookie },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      status: "found",
      value: "available",
    });
  });

  it("maps missing permission to 403 without details and preserves Authentication", async () => {
    const fixture = await createTenantFixture({ role: "Viewer" });
    const before = await readSessionState(fixture.sessionId);

    const response = await request(
      `/api/test-only/tenant-authorization/${fixture.membershipId}`,
      { cookie: fixture.cookie },
    );

    await expectSafeError(response, 403, "AUTHORIZATION_DENIED");
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(readSessionState(fixture.sessionId)).resolves.toEqual(before);
    await expectIdentityOnly(fixture.cookie, fixture.userId);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logChunks.join("")).toContain("authorization.denied");
    expect(logChunks.join("")).not.toContain(fixture.cookie);
  });

  it("returns repeatable stale 403 responses without revoking or changing the Session snapshot", async () => {
    const fixture = await createTenantFixture({
      membershipVersion: 6n,
      role: "Admin",
      sessionVersion: 5n,
    });
    const before = await readSessionState(fixture.sessionId);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(
        `/api/test-only/tenant-authorization/${fixture.membershipId}`,
        { cookie: fixture.cookie },
      );
      await expectSafeError(response, 403, "AUTHORIZATION_DENIED", {
        authorizationState: "stale",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    }

    await expect(readSessionState(fixture.sessionId)).resolves.toEqual(before);
    expect(before.currentMembershipAuthorizationVersion).toBe("5");
    expect(before.revokedAt).toBeNull();
    await expectIdentityOnly(fixture.cookie, fixture.userId);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logChunks.join("")).toContain("authorization.stale");
    expect(logChunks.join("")).not.toContain(fixture.cookie);
  });

  it("maps invalid fixed PermissionRequirement configuration to sanitized 500", async () => {
    const fixture = await createTenantFixture({ role: "Admin" });

    const response = await request(
      "/api/test-only/authorization-configuration/invalid-requirement",
      { cookie: fixture.cookie },
    );

    await expectSafeError(response, 500, "INTERNAL_SERVER_ERROR");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logChunks.join("")).toContain("authorization.requirement.invalid");
    expect(logChunks.join("")).not.toContain("unknown.permission");
  });

  it("leaves persistence failures to the existing sanitized 500 boundary", async () => {
    const fixture = await createTenantFixture({ role: "Admin" });
    const persistence = vi
      .spyOn(authorizationScope, "runAuthorized")
      .mockRejectedValueOnce(
        new TenantPersistenceError(
          new Error("synthetic authorization database failure"),
        ),
      );

    try {
      await expectSafeError(
        await request(
          `/api/test-only/tenant-authorization/${fixture.membershipId}`,
          { cookie: fixture.cookie },
        ),
        500,
        "INTERNAL_SERVER_ERROR",
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(logChunks.join("")).not.toContain(
        "synthetic authorization database failure",
      );
      expect(logChunks.join("")).not.toContain(fixture.cookie);
    } finally {
      persistence.mockRestore();
    }
  });

  it("ignores client role, permission, and authorization version claims", async () => {
    const viewer = await createTenantFixture({ role: "Viewer" });
    const spoofedPath =
      `/api/test-only/tenant-authorization/${viewer.membershipId}` +
      "?permission=memberships.manage&role=Owner&authorizationVersion=999";

    await expectSafeError(
      await request(spoofedPath, {
        authorizationVersion: "999",
        body: {
          authorizationVersion: "999",
          permission: "memberships.manage",
          role: "Owner",
        },
        cookie: viewer.cookie,
        permission: "memberships.manage",
        role: "Owner",
      }),
      403,
      "AUTHORIZATION_DENIED",
    );

    const admin = await createTenantFixture({ role: "Admin" });
    const allowed = await request(
      `/api/test-only/tenant-authorization/${admin.membershipId}` +
        "?permission=unknown.permission&role=Viewer&authorizationVersion=0",
      {
        authorizationVersion: "0",
        body: {
          authorizationVersion: "0",
          permission: "unknown.permission",
          role: "Viewer",
        },
        cookie: admin.cookie,
        permission: "unknown.permission",
        role: "Viewer",
      },
    );
    expect(allowed.status).toBe(201);
  });

  it("maps a cross-tenant resource selector to not-found without revealing it", async () => {
    const tenantA = await createTenantFixture({ role: "Admin" });
    const tenantB = await createTenantFixture({ role: "Admin" });

    const response = await request(
      `/api/test-only/tenant-authorization/${tenantB.membershipId}`,
      { cookie: tenantA.cookie },
    );

    const body = await expectSafeError(response, 404, "RESOURCE_NOT_FOUND");
    expect(JSON.stringify(body)).not.toContain(tenantB.membershipId);
  });
});
