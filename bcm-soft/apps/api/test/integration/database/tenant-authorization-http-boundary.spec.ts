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
    }> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
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
    await fixtureSql.connect();
    await authorizationLifecycle.connect();
    app = await NestFactory.create(TenantAuthorizationTestModule, {
      abortOnError: false,
      logger: observability.logger,
    });
    app.setGlobalPrefix("api");
    configureObservability(app, observability);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }, 30_000);

  beforeEach(() => {
    logChunks.length = 0;
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await authorizationLifecycle.disconnect();
    await fixtureSql.end();
  });

  it("keeps missing Authentication as 401 AUTHENTICATION_REQUIRED", async () => {
    await expectSafeError(
      await request(`/api/test-only/tenant-authorization/${generateUuidV7()}`),
      401,
      "AUTHENTICATION_REQUIRED",
    );
  });

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
      membershipVersion: 2n,
      role: "Admin",
      sessionVersion: 1n,
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
    expect(before.currentMembershipAuthorizationVersion).toBe("1");
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
