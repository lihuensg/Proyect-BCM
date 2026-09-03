import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import {
  Controller,
  Inject,
  Injectable,
  Module,
  Post,
  UseGuards,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "../../../src/app.module.js";
import { loadServerConfig } from "../../../src/config/server-config.js";
import { NodeSessionTokenService } from "../../../src/identity/infrastructure/node-session-token-service.js";
import { SessionCookieCodec } from "../../../src/identity/presentation/session-cookie-codec.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import {
  configureObservability,
  createObservability,
} from "../../../src/observability/observability.js";
import type {
  TenantAuthorityResolver,
  TenantContext,
} from "../../../src/tenancy/application/tenant-authority.js";
import { TenantAuthorityPersistenceError } from "../../../src/tenancy/application/tenant-authority.js";
import {
  TenantPersistenceError,
  type TenantPersistenceScope,
} from "../../../src/tenancy/application/tenant-persistence-scope.js";
import { TenantAuthorityGuard } from "../../../src/tenancy/presentation/tenant-authority.guard.js";
import { tenantAccessDenied } from "../../../src/tenancy/presentation/tenant-http-errors.js";
import { CurrentTenant } from "../../../src/tenancy/presentation/tenant-request-context.js";
import {
  TENANT_AUTHORITY_RESOLVER,
  TENANT_PERSISTENCE_SCOPE,
  type TenantRuntimeRepositories,
} from "../../../src/tenancy/tenancy.tokens.js";

type MembershipStatus = "Active" | "Suspended" | "Revoked";
type OrganizationStatus = "Active" | "Inactive";

type AuthenticatedSessionFixture = Readonly<{
  cookie: string;
  sessionId: string;
  userId: string;
}>;

type TenantProbeResponse = Readonly<{
  executedWithinTenantPersistenceScope: true;
  membershipId: string;
  organizationId: string;
  sessionId: string;
  userId: string;
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

class TenantBoundaryProbeUseCase {
  lastContext: TenantContext | undefined;

  constructor(
    private readonly persistence: TenantPersistenceScope<TenantRuntimeRepositories>,
  ) {}

  async execute(context: TenantContext): Promise<TenantProbeResponse> {
    this.lastContext = context;
    const result = await this.persistence.run(context, async () => ({
      executedWithinTenantPersistenceScope: true as const,
      membershipId: context.membershipId,
      organizationId: context.organizationId,
      sessionId: context.sessionId,
      userId: context.userId,
    }));
    if (result.status === "denied") throw tenantAccessDenied();
    return result.value;
  }
}

class TenantBoundaryTestController {
  constructor(private readonly probe: TenantBoundaryProbeUseCase) {}

  execute(context: TenantContext): Promise<TenantProbeResponse> {
    return this.probe.execute(context);
  }

  executeWithPath(context: TenantContext): Promise<TenantProbeResponse> {
    return this.probe.execute(context);
  }
}

Inject(TENANT_PERSISTENCE_SCOPE)(TenantBoundaryProbeUseCase, undefined, 0);
Injectable()(TenantBoundaryProbeUseCase);
Inject(TenantBoundaryProbeUseCase)(TenantBoundaryTestController, undefined, 0);
const executeDescriptor = Object.getOwnPropertyDescriptor(
  TenantBoundaryTestController.prototype,
  "execute",
);
if (executeDescriptor === undefined) {
  throw new Error("The test-only tenant boundary handler is unavailable.");
}
CurrentTenant()(TenantBoundaryTestController.prototype, "execute", 0);
Post()(TenantBoundaryTestController.prototype, "execute", executeDescriptor);
UseGuards(TenantAuthorityGuard)(
  TenantBoundaryTestController.prototype,
  "execute",
  executeDescriptor,
);
const executeWithPathDescriptor = Object.getOwnPropertyDescriptor(
  TenantBoundaryTestController.prototype,
  "executeWithPath",
);
if (executeWithPathDescriptor === undefined) {
  throw new Error("The test-only tenant path handler is unavailable.");
}
CurrentTenant()(TenantBoundaryTestController.prototype, "executeWithPath", 0);
Post(":organizationId")(
  TenantBoundaryTestController.prototype,
  "executeWithPath",
  executeWithPathDescriptor,
);
UseGuards(TenantAuthorityGuard)(
  TenantBoundaryTestController.prototype,
  "executeWithPath",
  executeWithPathDescriptor,
);
Controller("test-only/tenant-boundary")(TenantBoundaryTestController);

// Nest metadata is applied below without decorator syntax because the test
// transform does not support parameter decorators outside the source tree.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class TenantBoundaryTestModule {}
Module({
  imports: [AppModule.register(config, observability.logger)],
  controllers: [TenantBoundaryTestController],
  providers: [TenantBoundaryProbeUseCase],
})(TenantBoundaryTestModule);

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

describe("Tenant authority Nest/HTTP boundary with PostgreSQL", () => {
  const fixtureSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });
  const tokens = new NodeSessionTokenService();
  const cookies = new SessionCookieCodec(config.sessionCookie, tokens);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;

  async function createUser(): Promise<string> {
    const userId = generateUuidV7();
    const email = `${userId}@tenant-http.test`;
    const now = new Date();
    await fixtureSql.query(
      `INSERT INTO users
        (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $2, 'Active', $3, $3)`,
      [userId, email, now],
    );
    return userId;
  }

  async function createOrganization(
    status: OrganizationStatus = "Active",
  ): Promise<string> {
    const organizationId = generateUuidV7();
    const now = new Date();
    await fixtureSql.query(
      `INSERT INTO organizations
        (id, name, status, timezone, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, 'America/Argentina/Buenos_Aires', $4, $4)`,
      [organizationId, `Organization ${organizationId}`, status, now],
    );
    return organizationId;
  }

  async function createMembership(
    userId: string,
    organizationId: string,
    status: MembershipStatus = "Active",
    authorizationVersion = 1n,
  ): Promise<string> {
    const membershipId = generateUuidV7();
    const now = new Date();
    await fixtureSql.query(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, authorization_version,
         activated_at, revoked_at, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Viewer', $4, $5,
               $6, $7, $6, $6)`,
      [
        membershipId,
        organizationId,
        userId,
        status,
        authorizationVersion.toString(),
        now,
        status === "Revoked" ? now : null,
      ],
    );
    return membershipId;
  }

  async function createAuthenticatedSession(
    userId: string,
    selection: Readonly<{
      authorizationVersion: bigint;
      organizationId: string;
    }> | null = null,
  ): Promise<AuthenticatedSessionFixture> {
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
        selection?.organizationId ?? null,
        selection?.authorizationVersion.toString() ?? null,
        expiresAt,
        now,
      ],
    );
    return {
      cookie: cookiePair(cookies.serialize(rawToken, expiresAt)),
      sessionId,
      userId,
    };
  }

  async function request(
    path = "/api/test-only/tenant-boundary",
    input: Readonly<{
      body?: unknown;
      cookie?: string;
      organizationHeader?: string;
      tenantHeader?: string;
    }> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (input.cookie !== undefined) headers.cookie = input.cookie;
    if (input.organizationHeader !== undefined) {
      headers["x-organization-id"] = input.organizationHeader;
    }
    if (input.tenantHeader !== undefined) {
      headers["x-tenant-id"] = input.tenantHeader;
    }
    if (input.body !== undefined) headers["content-type"] = "application/json";

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
  ): Promise<Readonly<Record<string, unknown>>> {
    expect(response.status).toBe(status);
    const body = (await response.json()) as Readonly<Record<string, unknown>>;
    expect(body).toEqual({
      statusCode: status,
      code,
      message: expect.any(String),
      requestId: expect.any(String),
    });
    return body;
  }

  beforeAll(async () => {
    await fixtureSql.connect();
    app = await NestFactory.create(TenantBoundaryTestModule, {
      abortOnError: false,
      logger: observability.logger,
    });
    app.setGlobalPrefix("api");
    configureObservability(app, observability);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }, 30_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await fixtureSql.end();
  });

  it("returns 401 AUTHENTICATION_REQUIRED without a backend Session", async () => {
    await expectSafeError(await request(), 401, "AUTHENTICATION_REQUIRED");
  });

  it("returns tenant 403 for zero Memberships and preserves the valid Session", async () => {
    const userId = await createUser();
    const session = await createAuthenticatedSession(userId);

    await expectSafeError(
      await request(undefined, { cookie: session.cookie }),
      403,
      "TENANT_ACCESS_DENIED",
    );
    const persisted = await fixtureSql.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM sessions WHERE id = $1::uuid",
      [session.sessionId],
    );
    expect(persisted.rows[0]?.revoked_at).toBeNull();
    const authentication = await request("/api/auth/session", {
      cookie: session.cookie,
    });
    expect(authentication.status).toBe(200);
  });

  it.each([
    ["Suspended Membership", "Suspended", "Active"],
    ["Revoked Membership", "Revoked", "Active"],
    ["Inactive Organization", "Active", "Inactive"],
  ] as const)(
    "returns tenant 403 for %s",
    async (_label, membershipStatus, organizationStatus) => {
      const userId = await createUser();
      const organizationId = await createOrganization(organizationStatus);
      await createMembership(userId, organizationId, membershipStatus);
      const session = await createAuthenticatedSession(userId);

      await expectSafeError(
        await request(undefined, { cookie: session.cookie }),
        403,
        "TENANT_ACCESS_DENIED",
      );
    },
  );

  it("returns 409 TENANT_SELECTION_REQUIRED without choosing among multiple tenants", async () => {
    const userId = await createUser();
    const firstOrganizationId = await createOrganization();
    const secondOrganizationId = await createOrganization();
    await createMembership(userId, firstOrganizationId);
    await createMembership(userId, secondOrganizationId);
    const session = await createAuthenticatedSession(userId);

    await expectSafeError(
      await request(undefined, { cookie: session.cookie }),
      409,
      "TENANT_SELECTION_REQUIRED",
    );
    const persisted = await fixtureSql.query<{
      current_organization_id: string | null;
    }>("SELECT current_organization_id FROM sessions WHERE id = $1::uuid", [
      session.sessionId,
    ]);
    expect(persisted.rows[0]?.current_organization_id).toBeNull();
    const sessionState = await fixtureSql.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM sessions WHERE id = $1::uuid",
      [session.sessionId],
    );
    expect(sessionState.rows[0]?.revoked_at).toBeNull();
    const authentication = await request("/api/auth/session", {
      cookie: session.cookie,
    });
    expect(authentication.status).toBe(200);
  });

  it("auto-selects one valid Membership and executes inside TenantPersistenceScope", async () => {
    const userId = await createUser();
    const organizationId = await createOrganization();
    const membershipId = await createMembership(
      userId,
      organizationId,
      "Active",
      7n,
    );
    const session = await createAuthenticatedSession(userId);

    const response = await request(undefined, { cookie: session.cookie });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      executedWithinTenantPersistenceScope: true,
      membershipId,
      organizationId,
      sessionId: session.sessionId,
      userId,
    });
    const persisted = await fixtureSql.query<{
      current_membership_authorization_version: string;
      current_organization_id: string;
    }>(
      `SELECT current_organization_id,
              current_membership_authorization_version::text
       FROM sessions WHERE id = $1::uuid`,
      [session.sessionId],
    );
    expect(persisted.rows[0]).toEqual({
      current_membership_authorization_version: "7",
      current_organization_id: organizationId,
    });
  });

  it("resolves concurrent first HTTP requests to the same atomically selected tenant", async () => {
    const userId = await createUser();
    const organizationId = await createOrganization();
    const membershipId = await createMembership(
      userId,
      organizationId,
      "Active",
      9n,
    );
    const session = await createAuthenticatedSession(userId);

    const responses = await Promise.all([
      request(undefined, { cookie: session.cookie }),
      request(undefined, { cookie: session.cookie }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const bodies = await Promise.all(
      responses.map(async (response) => response.json()),
    );
    expect(bodies).toEqual([
      expect.objectContaining({ membershipId, organizationId }),
      expect.objectContaining({ membershipId, organizationId }),
    ]);
    const persisted = await fixtureSql.query<{
      current_membership_authorization_version: string;
      current_organization_id: string;
    }>(
      `SELECT current_organization_id,
              current_membership_authorization_version::text
       FROM sessions WHERE id = $1::uuid`,
      [session.sessionId],
    );
    expect(persisted.rows[0]).toEqual({
      current_membership_authorization_version: "9",
      current_organization_id: organizationId,
    });
  });

  it("delivers the exact resolver TenantContext for a valid existing selection", async () => {
    const userId = await createUser();
    const organizationId = await createOrganization();
    const membershipId = await createMembership(
      userId,
      organizationId,
      "Active",
      11n,
    );
    const session = await createAuthenticatedSession(userId, {
      authorizationVersion: 11n,
      organizationId,
    });
    const resolver = app.get<TenantAuthorityResolver>(
      TENANT_AUTHORITY_RESOLVER,
    );
    const originalResolve = resolver.resolve.bind(resolver);
    let resolvedContext: TenantContext | undefined;
    const resolutionSpy = vi
      .spyOn(resolver, "resolve")
      .mockImplementation(async (identity) => {
        const resolution = await originalResolve(identity);
        if (resolution.status === "resolved")
          resolvedContext = resolution.context;
        return resolution;
      });

    try {
      const response = await request(undefined, { cookie: session.cookie });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        membershipId,
        organizationId,
      });
      expect(app.get(TenantBoundaryProbeUseCase).lastContext).toBe(
        resolvedContext,
      );
    } finally {
      resolutionSpy.mockRestore();
    }
  });

  it("denies an invalid selected tenant without falling back to valid B", async () => {
    const userId = await createUser();
    const selectedOrganizationId = await createOrganization();
    await createMembership(userId, selectedOrganizationId, "Suspended");
    const validOrganizationId = await createOrganization();
    await createMembership(userId, validOrganizationId);
    const session = await createAuthenticatedSession(userId, {
      authorizationVersion: 1n,
      organizationId: selectedOrganizationId,
    });

    await expectSafeError(
      await request(undefined, { cookie: session.cookie }),
      403,
      "TENANT_ACCESS_DENIED",
    );
    const persisted = await fixtureSql.query<{
      current_organization_id: string;
    }>("SELECT current_organization_id FROM sessions WHERE id = $1::uuid", [
      session.sessionId,
    ]);
    expect(persisted.rows[0]?.current_organization_id).toBe(
      selectedOrganizationId,
    );
  });

  it("denies a cross-user Membership", async () => {
    const sessionUserId = await createUser();
    const membershipUserId = await createUser();
    const organizationId = await createOrganization();
    await createMembership(membershipUserId, organizationId);
    const session = await createAuthenticatedSession(sessionUserId);

    await expectSafeError(
      await request(undefined, { cookie: session.cookie }),
      403,
      "TENANT_ACCESS_DENIED",
    );
  });

  it("ignores attacker-supplied tenant and identity fields across HTTP inputs", async () => {
    const userId = await createUser();
    const organizationAId = await createOrganization();
    const membershipAId = await createMembership(userId, organizationAId);
    const organizationBId = await createOrganization();
    const session = await createAuthenticatedSession(userId, {
      authorizationVersion: 1n,
      organizationId: organizationAId,
    });

    const attackerMembershipId = generateUuidV7();
    const attackerUserId = generateUuidV7();
    const response = await request(
      `/api/test-only/tenant-boundary/${organizationBId}` +
        `?organizationId=${organizationBId}` +
        `&membershipId=${attackerMembershipId}` +
        `&userId=${attackerUserId}`,
      {
        body: {
          membershipId: attackerMembershipId,
          organizationId: organizationBId,
          userId: attackerUserId,
        },
        cookie: session.cookie,
        organizationHeader: organizationBId,
        tenantHeader: organizationBId,
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      membershipId: membershipAId,
      organizationId: organizationAId,
    });
  });

  it("maps resolver persistence failure to operational 500 with requestId", async () => {
    const userId = await createUser();
    const organizationId = await createOrganization();
    await createMembership(userId, organizationId);
    const session = await createAuthenticatedSession(userId);
    const resolver = app.get<TenantAuthorityResolver>(
      TENANT_AUTHORITY_RESOLVER,
    );
    const resolutionSpy = vi
      .spyOn(resolver, "resolve")
      .mockRejectedValueOnce(
        new TenantAuthorityPersistenceError(
          new Error("synthetic resolver database failure"),
        ),
      );

    try {
      await expectSafeError(
        await request(undefined, { cookie: session.cookie }),
        500,
        "INTERNAL_SERVER_ERROR",
      );
    } finally {
      resolutionSpy.mockRestore();
    }
  });

  it("maps TenantPersistenceScope failure to operational 500 rather than tenant 403", async () => {
    const userId = await createUser();
    const organizationId = await createOrganization();
    await createMembership(userId, organizationId);
    const session = await createAuthenticatedSession(userId);
    const persistence = app.get<
      TenantPersistenceScope<TenantRuntimeRepositories>
    >(TENANT_PERSISTENCE_SCOPE);
    const persistenceSpy = vi
      .spyOn(persistence, "run")
      .mockRejectedValueOnce(
        new TenantPersistenceError(
          new Error("synthetic tenant persistence failure"),
        ),
      );

    try {
      await expectSafeError(
        await request(undefined, { cookie: session.cookie }),
        500,
        "INTERNAL_SERVER_ERROR",
      );
    } finally {
      persistenceSpy.mockRestore();
    }
  });

  it("keeps request IDs stable in tenant boundary errors without leaking authority detail", async () => {
    const requestId = randomUUID();
    const response = await fetch(`${baseUrl}/api/test-only/tenant-boundary`, {
      method: "POST",
      headers: { "x-request-id": requestId },
    });
    const body = await expectSafeError(
      response,
      401,
      "AUTHENTICATION_REQUIRED",
    );

    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(body.requestId).toBe(requestId);
    expect(JSON.stringify(body)).not.toMatch(
      /membership|organization|cookie|token|sessionId/iu,
    );
  });
});
