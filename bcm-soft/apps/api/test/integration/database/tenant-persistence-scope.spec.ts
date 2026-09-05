import { randomBytes } from "node:crypto";

import type { Prisma } from "../../../src/generated/prisma/client.js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadServerConfig } from "../../../src/config/server-config.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import {
  definePermissionRequirement,
  type MembershipRole,
} from "../../../src/tenancy/application/authorization.js";
import type { TenantContext } from "../../../src/tenancy/application/tenant-authority.js";
import {
  FailClosedTenantAuthorityResolver,
  type TenantAuthoritySnapshotProvider,
} from "../../../src/tenancy/application/tenant-authority.js";
import {
  TenantPersistenceError,
  TenantRepositoryScopeClosedError,
  type TenantRepositoryScopeLease,
} from "../../../src/tenancy/application/tenant-persistence-scope.js";
import {
  ORGANIZATION_AUTHORITY_LOCK_NAMESPACE,
  PrismaTenantPersistenceScope,
} from "../../../src/tenancy/infrastructure/prisma-tenant-persistence-scope.js";

type MembershipStatus = "Active" | "Suspended" | "Revoked";

type AuthorityFixture = Readonly<{
  context: TenantContext;
  membershipId: string;
  organizationId: string;
  resourceId: string;
  sessionId: string;
  userId: string;
}>;

type AuthorityFixtureOptions = Readonly<{
  membershipVersion?: bigint;
  role?: MembershipRole;
  sessionVersion?: bigint;
}>;

type ProbeReadResult =
  | Readonly<{ status: "found"; value: string }>
  | Readonly<{ status: "not-found" }>;

type ProbeWriteResult =
  Readonly<{ status: "updated" }> | Readonly<{ status: "not-found" }>;

type TenantProbeRepository = Readonly<{
  findById(resourceId: string): Promise<ProbeReadResult>;
  updateValue(resourceId: string, value: string): Promise<ProbeWriteResult>;
}>;

class MutableClock {
  constructor(public value: Date) {}
  now(): Date {
    return this.value;
  }
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (resolver === undefined) throw new Error("Deferred is not ready.");
      resolver();
    },
  };
}

describe("PostgreSQL tenant persistence scope", () => {
  const config = loadServerConfig(process.env);
  const lifecycle = new PrismaClientLifecycle(config.database.runtimeUrl, {
    max: 8,
  });
  const fixtureSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });
  const raceSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });
  const now = new Date("2026-08-30T20:00:00.000Z");
  const clock = new MutableClock(now);
  const ORGANIZATION_READ = definePermissionRequirement("organization.read");
  const MEMBERSHIPS_MANAGE = definePermissionRequirement("memberships.manage");
  const MEMBERSHIPS_MANAGE_OWNER = definePermissionRequirement(
    "memberships.manage_owner",
  );

  function createProbeRepository(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    lease: TenantRepositoryScopeLease,
  ): TenantProbeRepository {
    return Object.freeze({
      findById: async (resourceId: string): Promise<ProbeReadResult> => {
        lease.assertActive();
        const rows = await transaction.$queryRaw<Array<{ value: string }>>`
          SELECT probe.value
          FROM test_tenant_persistence_probe AS probe
          WHERE probe.organization_id = ${organizationId}::uuid
            AND probe.id = ${resourceId}::uuid
          LIMIT 2
        `;
        if (rows.length > 1) {
          throw new TenantPersistenceError(
            new Error("The tenant probe lookup returned duplicate rows."),
          );
        }
        const row = rows[0];
        return row === undefined
          ? Object.freeze({ status: "not-found" })
          : Object.freeze({ status: "found", value: row.value });
      },
      updateValue: async (
        resourceId: string,
        value: string,
      ): Promise<ProbeWriteResult> => {
        lease.assertActive();
        const updated = await transaction.$executeRaw`
          UPDATE test_tenant_persistence_probe
          SET value = ${value}
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${resourceId}::uuid
        `;
        return updated === 1
          ? Object.freeze({ status: "updated" })
          : Object.freeze({ status: "not-found" });
      },
    });
  }

  const scope = new PrismaTenantPersistenceScope(
    lifecycle.client,
    clock,
    config.session.idleTimeoutMilliseconds,
    createProbeRepository,
  );

  async function createUser(status: "Active" | "Disabled" = "Active") {
    const userId = generateUuidV7();
    const email = `${userId}@tenant-persistence.test`;
    await fixtureSql.query(
      `INSERT INTO users
        (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $2, $3, $4, $4)`,
      [userId, email, status, now],
    );
    return userId;
  }

  async function createOrganization(status: "Active" | "Inactive" = "Active") {
    const organizationId = generateUuidV7();
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
    role: MembershipRole = "Viewer",
    authorizationVersion = 1n,
  ) {
    const membershipId = generateUuidV7();
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
    authorizationVersion = 1n,
  ) {
    const sessionId = generateUuidV7();
    await fixtureSql.query(
      `INSERT INTO sessions
        (id, token_hash, user_id, current_organization_id,
         current_membership_authorization_version, expires_at, revoked_at,
         last_seen_at, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5,
               $6, NULL, $7, $7)`,
      [
        sessionId,
        randomBytes(32),
        userId,
        organizationId,
        authorizationVersion,
        new Date(now.getTime() + 60 * 60_000),
        now,
      ],
    );
    return sessionId;
  }

  async function mintContext(
    userId: string,
    sessionId: string,
    organizationId: string,
    membershipId: string,
  ): Promise<TenantContext> {
    const snapshots: TenantAuthoritySnapshotProvider = {
      loadFor: async () =>
        Object.freeze({
          status: "available" as const,
          selectedOrganizationId: organizationId,
          memberships: Object.freeze([
            Object.freeze({
              membershipId,
              userId,
              organizationId,
              membershipStatus: "Active" as const,
              organizationStatus: "Active" as const,
            }),
          ]),
        }),
    };
    const resolution = await new FailClosedTenantAuthorityResolver(
      snapshots,
    ).resolve(Object.freeze({ userId, sessionId }));
    if (resolution.status !== "resolved") {
      throw new Error("The test TenantContext could not be resolved.");
    }
    return resolution.context;
  }

  async function createFixture(
    options: AuthorityFixtureOptions = {},
  ): Promise<AuthorityFixture> {
    const userId = await createUser();
    const organizationId = await createOrganization();
    const membershipVersion = options.membershipVersion ?? 1n;
    const membershipId = await createMembership(
      userId,
      organizationId,
      "Active",
      options.role ?? "Viewer",
      membershipVersion,
    );
    const sessionId = await createSession(
      userId,
      organizationId,
      options.sessionVersion ?? membershipVersion,
    );
    const resourceId = generateUuidV7();
    await fixtureSql.query(
      `INSERT INTO test_tenant_persistence_probe
        (id, organization_id, value)
       VALUES ($1::uuid, $2::uuid, 'initial')`,
      [resourceId, organizationId],
    );
    return Object.freeze({
      context: await mintContext(
        userId,
        sessionId,
        organizationId,
        membershipId,
      ),
      membershipId,
      organizationId,
      resourceId,
      sessionId,
      userId,
    });
  }

  function mismatchedContext(
    context: TenantContext,
    overrides: Partial<
      Pick<
        TenantContext,
        "membershipId" | "organizationId" | "sessionId" | "userId"
      >
    >,
  ): TenantContext {
    return Object.freeze({ ...context, ...overrides });
  }

  async function probeValue(resourceId: string): Promise<string> {
    const result = await fixtureSql.query<{ value: string }>(
      `SELECT value
       FROM test_tenant_persistence_probe
       WHERE id = $1::uuid`,
      [resourceId],
    );
    const value = result.rows[0]?.value;
    if (value === undefined) throw new Error("The test probe is missing.");
    return value;
  }

  async function waitForClientLock(client: Client): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await fixtureSql.query<{ is_blocked: boolean }>(
        `SELECT cardinality(pg_blocking_pids($1)) > 0 AS is_blocked`,
        [client.processID],
      );
      if (state.rows[0]?.is_blocked === true) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("The competing transaction did not wait for the lock.");
  }

  beforeAll(async () => {
    await fixtureSql.connect();
    await raceSql.connect();
    await lifecycle.connect();
    await fixtureSql.query(`
      CREATE TABLE test_tenant_persistence_probe (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        value text NOT NULL
      );
      CREATE INDEX ix_test_tenant_persistence_probe__organization_id_id
        ON test_tenant_persistence_probe (organization_id, id);
      REVOKE ALL PRIVILEGES ON TABLE test_tenant_persistence_probe FROM PUBLIC;
      GRANT SELECT, INSERT, UPDATE, DELETE
        ON TABLE test_tenant_persistence_probe TO bcm_soft_runtime;
    `);
  });

  afterAll(async () => {
    await lifecycle.disconnect();
    await raceSql.end();
    await fixtureSql.query("DROP TABLE test_tenant_persistence_probe");
    await fixtureSql.end();
  });

  it("executes a valid operation with a tenant-bound repository", async () => {
    const fixture = await createFixture();

    const result = await scope.run(fixture.context, async (repositories) => {
      const read = await repositories.findById(fixture.resourceId);
      const write = await repositories.updateValue(
        fixture.resourceId,
        "tenant-a-updated",
      );
      return { read, write };
    });

    expect(result).toEqual({
      status: "executed",
      value: {
        read: { status: "found", value: "initial" },
        write: { status: "updated" },
      },
    });
    await expect(probeValue(fixture.resourceId)).resolves.toBe(
      "tenant-a-updated",
    );
  });

  it("hides cross-tenant reads and writes as not-found", async () => {
    const tenantA = await createFixture();
    const tenantB = await createFixture();

    const result = await scope.run(tenantA.context, async (repositories) => ({
      read: await repositories.findById(tenantB.resourceId),
      write: await repositories.updateValue(
        tenantB.resourceId,
        "must-not-update",
      ),
    }));

    expect(result).toEqual({
      status: "executed",
      value: {
        read: { status: "not-found" },
        write: { status: "not-found" },
      },
    });
    await expect(probeValue(tenantB.resourceId)).resolves.toBe("initial");
  });

  it.each([
    ["userId", () => generateUuidV7()],
    ["sessionId", () => generateUuidV7()],
    ["organizationId", () => generateUuidV7()],
    ["membershipId", () => generateUuidV7()],
  ] as const)(
    "denies a mismatched %s without invoking the callback",
    async (field, value) => {
      const fixture = await createFixture();
      const callback = vi.fn(async () => "must-not-run");
      const context = mismatchedContext(fixture.context, {
        [field]: value(),
      });

      await expect(scope.run(context, callback)).resolves.toEqual({
        status: "denied",
      });
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it.each(["Suspended", "Revoked"] as const)(
    "denies a stale context whose Membership became %s",
    async (status) => {
      const fixture = await createFixture();
      await fixtureSql.query(
        `UPDATE organization_memberships
         SET status = $2,
             authorization_version = authorization_version + 1,
             revoked_at = CASE
               WHEN $2 = 'Revoked' THEN $3::timestamptz
               ELSE NULL::timestamptz
             END
         WHERE id = $1::uuid`,
        [fixture.membershipId, status, now],
      );
      const callback = vi.fn(async () => "must-not-run");

      await expect(scope.run(fixture.context, callback)).resolves.toEqual({
        status: "denied",
      });
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it("denies stale Organization and Session authority", async () => {
    const organizationFixture = await createFixture();
    const sessionFixture = await createFixture();
    await fixtureSql.query(
      "UPDATE organizations SET status = 'Inactive' WHERE id = $1::uuid",
      [organizationFixture.organizationId],
    );
    await fixtureSql.query(
      "UPDATE sessions SET revoked_at = $2 WHERE id = $1::uuid",
      [sessionFixture.sessionId, now],
    );
    const organizationCallback = vi.fn(async () => undefined);
    const sessionCallback = vi.fn(async () => undefined);

    await expect(
      scope.run(organizationFixture.context, organizationCallback),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      scope.run(sessionFixture.context, sessionCallback),
    ).resolves.toEqual({ status: "denied" });
    expect(organizationCallback).not.toHaveBeenCalled();
    expect(sessionCallback).not.toHaveBeenCalled();
  });

  it.each([
    "absolute-expired",
    "idle-expired",
    "disabled-user",
    "missing-version",
  ] as const)(
    "denies a stale context with %s Session authority",
    async (caseName) => {
      const fixture = await createFixture();
      switch (caseName) {
        case "absolute-expired":
          clock.value = new Date(now.getTime() + 60 * 60_000);
          break;
        case "idle-expired":
          clock.value = new Date(
            now.getTime() + config.session.idleTimeoutMilliseconds,
          );
          break;
        case "disabled-user":
          await fixtureSql.query(
            "UPDATE users SET status = 'Disabled' WHERE id = $1::uuid",
            [fixture.userId],
          );
          break;
        case "missing-version":
          await fixtureSql.query(
            `UPDATE sessions
             SET current_organization_id = NULL,
                 current_membership_authorization_version = NULL
             WHERE id = $1::uuid`,
            [fixture.sessionId],
          );
          break;
      }
      const callback = vi.fn(async () => undefined);

      try {
        await expect(scope.run(fixture.context, callback)).resolves.toEqual({
          status: "denied",
        });
        expect(callback).not.toHaveBeenCalled();
      } finally {
        clock.value = now;
      }
    },
  );

  it("makes a retained repository unusable after the callback", async () => {
    const fixture = await createFixture();
    let retainedRepository: TenantProbeRepository | undefined;

    await expect(
      scope.run(fixture.context, async (repositories) => {
        retainedRepository = repositories;
        return "done";
      }),
    ).resolves.toEqual({ status: "executed", value: "done" });

    if (retainedRepository === undefined) {
      throw new Error("The repository was not retained by the test.");
    }
    await expect(
      retainedRepository.findById(fixture.resourceId),
    ).rejects.toBeInstanceOf(TenantRepositoryScopeClosedError);
  });

  it("makes a repository returned as the operation result unusable", async () => {
    const fixture = await createFixture();

    const result = await scope.run(
      fixture.context,
      async (repositories) => repositories,
    );

    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    await expect(
      result.value.findById(fixture.resourceId),
    ).rejects.toBeInstanceOf(TenantRepositoryScopeClosedError);
  });

  it("closes a retained repository when the callback throws", async () => {
    const fixture = await createFixture();
    let retainedRepository: TenantProbeRepository | undefined;

    await expect(
      scope.run(fixture.context, async (repositories) => {
        retainedRepository = repositories;
        throw new Error("synthetic callback failure");
      }),
    ).rejects.toBeInstanceOf(TenantPersistenceError);

    if (retainedRepository === undefined) {
      throw new Error("The repository was not retained by the test.");
    }
    await expect(
      retainedRepository.findById(fixture.resourceId),
    ).rejects.toBeInstanceOf(TenantRepositoryScopeClosedError);
  });

  it("preserves transaction failures as infrastructure errors", async () => {
    const fixture = await createFixture();
    const transaction = vi.spyOn(lifecycle.client, "$transaction");
    transaction.mockRejectedValueOnce(
      new Error("synthetic transaction failure"),
    );
    try {
      await expect(
        scope.run(fixture.context, async () => "must-not-run"),
      ).rejects.toBeInstanceOf(TenantPersistenceError);
    } finally {
      transaction.mockRestore();
    }
  });

  it.each(["Suspended", "Revoked"] as const)(
    "linearizes the tenant operation before a concurrent Membership change to %s",
    async (status) => {
      const fixture = await createFixture();
      const operationStarted = deferred();
      const releaseOperation = deferred();
      const operation = scope.run(fixture.context, async (repositories) => {
        operationStarted.resolve();
        await releaseOperation.promise;
        return repositories.updateValue(fixture.resourceId, "operation-won");
      });
      await operationStarted.promise;

      const authorityChange = raceSql.query(
        `UPDATE organization_memberships
         SET status = $2,
             authorization_version = authorization_version + 1,
             revoked_at = CASE
               WHEN $2 = 'Revoked' THEN $3::timestamptz
               ELSE NULL::timestamptz
             END
         WHERE id = $1::uuid`,
        [fixture.membershipId, status, now],
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      releaseOperation.resolve();

      await expect(operation).resolves.toEqual({
        status: "executed",
        value: { status: "updated" },
      });
      await authorityChange;
      await expect(probeValue(fixture.resourceId)).resolves.toBe(
        "operation-won",
      );
    },
  );

  it("rolls back when Organization inactivation commits during the callback", async () => {
    const fixture = await createFixture();
    const operationStarted = deferred();
    const releaseOperation = deferred();
    const operation = scope.run(fixture.context, async (repositories) => {
      operationStarted.resolve();
      await releaseOperation.promise;
      return repositories.updateValue(fixture.resourceId, "must-roll-back");
    });
    await operationStarted.promise;

    await raceSql.query(
      "UPDATE organizations SET status = 'Inactive' WHERE id = $1::uuid",
      [fixture.organizationId],
    );
    releaseOperation.resolve();

    await expect(operation).resolves.toEqual({ status: "denied" });
    await expect(probeValue(fixture.resourceId)).resolves.toBe("initial");
  });

  it("serializes a compliant Organization inactivation after the tenant operation", async () => {
    const fixture = await createFixture();
    const operationStarted = deferred();
    const releaseOperation = deferred();
    const operation = scope.run(fixture.context, async (repositories) => {
      operationStarted.resolve();
      await releaseOperation.promise;
      return repositories.updateValue(fixture.resourceId, "operation-won");
    });
    await operationStarted.promise;

    await raceSql.query("BEGIN");
    const inactivation = (async () => {
      try {
        await raceSql.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended($1 || $2::text, 0)
           )`,
          [ORGANIZATION_AUTHORITY_LOCK_NAMESPACE, fixture.organizationId],
        );
        await raceSql.query(
          "UPDATE organizations SET status = 'Inactive' WHERE id = $1::uuid",
          [fixture.organizationId],
        );
        await raceSql.query("COMMIT");
      } catch (error: unknown) {
        await raceSql.query("ROLLBACK");
        throw error;
      }
    })();
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseOperation.resolve();

    await expect(operation).resolves.toEqual({
      status: "executed",
      value: { status: "updated" },
    });
    await inactivation;
    await expect(probeValue(fixture.resourceId)).resolves.toBe("operation-won");
  });

  it("linearizes the tenant operation before concurrent Session revocation", async () => {
    const fixture = await createFixture();
    const operationStarted = deferred();
    const releaseOperation = deferred();
    const operation = scope.run(fixture.context, async (repositories) => {
      operationStarted.resolve();
      await releaseOperation.promise;
      return repositories.updateValue(fixture.resourceId, "operation-won");
    });
    await operationStarted.promise;

    const revocation = raceSql.query(
      "UPDATE sessions SET revoked_at = $2 WHERE id = $1::uuid",
      [fixture.sessionId, now],
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseOperation.resolve();

    await expect(operation).resolves.toEqual({
      status: "executed",
      value: { status: "updated" },
    });
    await revocation;
    await expect(probeValue(fixture.resourceId)).resolves.toBe("operation-won");
  });

  it("executes an Admin operation with matching version and permission", async () => {
    const fixture = await createFixture({
      role: "Admin",
      membershipVersion: 5n,
    });

    const result = await scope.runAuthorized(
      fixture.context,
      MEMBERSHIPS_MANAGE,
      async ({ authorization, repositories }) => ({
        role: authorization.role,
        version: authorization.authorizationVersion,
        tenant: authorization.tenant,
        write: await repositories.updateValue(
          fixture.resourceId,
          "authorized-admin",
        ),
      }),
    );

    expect(result).toEqual({
      status: "executed",
      value: {
        role: "Admin",
        version: 5n,
        tenant: fixture.context,
        write: { status: "updated" },
      },
    });
    await expect(probeValue(fixture.resourceId)).resolves.toBe(
      "authorized-admin",
    );
  });

  it("denies an Admin permission that is not explicitly mapped", async () => {
    const fixture = await createFixture({ role: "Admin" });
    const callback = vi.fn(async () => "must-not-run");

    await expect(
      scope.runAuthorized(fixture.context, MEMBERSHIPS_MANAGE_OWNER, callback),
    ).resolves.toEqual({
      status: "authorization-denied",
      reason: "permission-denied",
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("executes organization.read for Viewer", async () => {
    const fixture = await createFixture({ role: "Viewer" });

    await expect(
      scope.runAuthorized(
        fixture.context,
        ORGANIZATION_READ,
        async ({ authorization, repositories }) => ({
          permissions: authorization.permissions,
          read: await repositories.findById(fixture.resourceId),
        }),
      ),
    ).resolves.toEqual({
      status: "executed",
      value: {
        permissions: ["organization.read"],
        read: { status: "found", value: "initial" },
      },
    });
  });

  it("keeps authorized repositories bound to one Organization", async () => {
    const tenantA = await createFixture({ role: "Viewer" });
    const tenantB = await createFixture({ role: "Viewer" });

    const result = await scope.runAuthorized(
      tenantA.context,
      ORGANIZATION_READ,
      async ({ repositories }) => ({
        read: await repositories.findById(tenantB.resourceId),
        write: await repositories.updateValue(
          tenantB.resourceId,
          "must-not-update",
        ),
      }),
    );

    expect(result).toEqual({
      status: "executed",
      value: {
        read: { status: "not-found" },
        write: { status: "not-found" },
      },
    });
    await expect(probeValue(tenantB.resourceId)).resolves.toBe("initial");
  });

  it("denies memberships.manage for Viewer without invoking the callback", async () => {
    const fixture = await createFixture({ role: "Viewer" });
    const callback = vi.fn(async () => "must-not-run");

    await expect(
      scope.runAuthorized(fixture.context, MEMBERSHIPS_MANAGE, callback),
    ).resolves.toEqual({
      status: "authorization-denied",
      reason: "permission-denied",
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it.each([
    ["older", 5n, 4n],
    ["newer", 5n, 6n],
  ] as const)(
    "denies a %s Session authorization snapshot",
    async (_caseName, membershipVersion, sessionVersion) => {
      const fixture = await createFixture({
        role: "Admin",
        membershipVersion,
        sessionVersion,
      });
      const callback = vi.fn(async () => "must-not-run");

      await expect(
        scope.runAuthorized(fixture.context, MEMBERSHIPS_MANAGE, callback),
      ).resolves.toEqual({
        status: "authorization-denied",
        reason: "stale-authorization",
      });
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it("preserves BIGINT authorization versions beyond Number.MAX_SAFE_INTEGER", async () => {
    const authorizationVersion = 9_007_199_254_740_993n;
    const fixture = await createFixture({
      role: "Admin",
      membershipVersion: authorizationVersion,
    });

    const result = await scope.runAuthorized(
      fixture.context,
      ORGANIZATION_READ,
      async ({ authorization }) => authorization.authorizationVersion,
    );

    expect(result).toEqual({
      status: "executed",
      value: authorizationVersion,
    });
  });

  it.each(["Suspended", "Revoked"] as const)(
    "keeps %s Membership as tenant authority denial",
    async (status) => {
      const fixture = await createFixture({ role: "Admin" });
      await fixtureSql.query(
        `UPDATE organization_memberships
         SET status = $2,
             authorization_version = authorization_version + 1,
             revoked_at = CASE
               WHEN $2 = 'Revoked' THEN $3::timestamptz
               ELSE NULL::timestamptz
             END,
             updated_at = $3
         WHERE id = $1::uuid`,
        [fixture.membershipId, status, now],
      );
      const callback = vi.fn(async () => "must-not-run");

      await expect(
        scope.runAuthorized(fixture.context, MEMBERSHIPS_MANAGE, callback),
      ).resolves.toEqual({ status: "tenant-denied" });
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it("keeps an Inactive Organization as tenant authority denial", async () => {
    const fixture = await createFixture({ role: "Admin" });
    await fixtureSql.query(
      "UPDATE organizations SET status = 'Inactive' WHERE id = $1::uuid",
      [fixture.organizationId],
    );
    const callback = vi.fn(async () => "must-not-run");

    await expect(
      scope.runAuthorized(fixture.context, MEMBERSHIPS_MANAGE, callback),
    ).resolves.toEqual({ status: "tenant-denied" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("keeps a revoked Session as tenant authority denial", async () => {
    const fixture = await createFixture({ role: "Admin" });
    await fixtureSql.query(
      "UPDATE sessions SET revoked_at = $2 WHERE id = $1::uuid",
      [fixture.sessionId, now],
    );
    const callback = vi.fn(async () => "must-not-run");

    await expect(
      scope.runAuthorized(fixture.context, MEMBERSHIPS_MANAGE, callback),
    ).resolves.toEqual({ status: "tenant-denied" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("makes every Session stale after one Membership version bump", async () => {
    const fixture = await createFixture({
      role: "Admin",
      membershipVersion: 5n,
    });
    const secondSessionId = await createSession(
      fixture.userId,
      fixture.organizationId,
      5n,
    );
    const secondContext = await mintContext(
      fixture.userId,
      secondSessionId,
      fixture.organizationId,
      fixture.membershipId,
    );
    await fixtureSql.query(
      `UPDATE organization_memberships
       SET role = 'Viewer',
           authorization_version = authorization_version + 1,
           updated_at = $2
       WHERE id = $1::uuid`,
      [fixture.membershipId, now],
    );

    const results = await Promise.all([
      scope.runAuthorized(fixture.context, ORGANIZATION_READ, async () => 1),
      scope.runAuthorized(secondContext, ORGANIZATION_READ, async () => 2),
    ]);

    expect(results).toEqual([
      {
        status: "authorization-denied",
        reason: "stale-authorization",
      },
      {
        status: "authorization-denied",
        reason: "stale-authorization",
      },
    ]);
    const sessions = await fixtureSql.query<{
      current_membership_authorization_version: string;
    }>(
      `SELECT current_membership_authorization_version::text
       FROM sessions
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[fixture.sessionId, secondSessionId]],
    );
    expect(
      sessions.rows.map(
        (session) => session.current_membership_authorization_version,
      ),
    ).toEqual(["5", "5"]);
  });

  it("isolates roles and versions between Organizations", async () => {
    const userId = await createUser();
    const organizationAId = await createOrganization();
    const organizationBId = await createOrganization();
    const membershipAId = await createMembership(
      userId,
      organizationAId,
      "Active",
      "Admin",
      3n,
    );
    const membershipBId = await createMembership(
      userId,
      organizationBId,
      "Active",
      "Viewer",
      7n,
    );
    const sessionAId = await createSession(userId, organizationAId, 3n);
    const sessionBId = await createSession(userId, organizationBId, 7n);
    const contextA = await mintContext(
      userId,
      sessionAId,
      organizationAId,
      membershipAId,
    );
    const contextB = await mintContext(
      userId,
      sessionBId,
      organizationBId,
      membershipBId,
    );

    const resultA = await scope.runAuthorized(
      contextA,
      MEMBERSHIPS_MANAGE,
      async ({ authorization }) => ({
        organizationId: authorization.tenant.organizationId,
        role: authorization.role,
        version: authorization.authorizationVersion,
      }),
    );
    const callbackB = vi.fn(async () => "must-not-run");
    const resultB = await scope.runAuthorized(
      contextB,
      MEMBERSHIPS_MANAGE,
      callbackB,
    );

    expect(resultA).toEqual({
      status: "executed",
      value: {
        organizationId: organizationAId,
        role: "Admin",
        version: 3n,
      },
    });
    expect(resultB).toEqual({
      status: "authorization-denied",
      reason: "permission-denied",
    });
    expect(callbackB).not.toHaveBeenCalled();
  });

  it("linearizes an authorized operation before a privilege reduction", async () => {
    const fixture = await createFixture({
      role: "Admin",
      membershipVersion: 5n,
    });
    const operationStarted = deferred();
    const releaseOperation = deferred();
    const operation = scope.runAuthorized(
      fixture.context,
      MEMBERSHIPS_MANAGE,
      async ({ repositories }) => {
        operationStarted.resolve();
        await releaseOperation.promise;
        return repositories.updateValue(fixture.resourceId, "operation-won");
      },
    );
    await operationStarted.promise;

    const authorityChange = raceSql.query(
      `UPDATE organization_memberships
       SET role = 'Viewer',
           authorization_version = authorization_version + 1,
           updated_at = $2
       WHERE id = $1::uuid`,
      [fixture.membershipId, now],
    );
    await waitForClientLock(raceSql);
    releaseOperation.resolve();

    await expect(operation).resolves.toEqual({
      status: "executed",
      value: { status: "updated" },
    });
    await authorityChange;
    await expect(probeValue(fixture.resourceId)).resolves.toBe("operation-won");
    await expect(
      scope.runAuthorized(
        fixture.context,
        MEMBERSHIPS_MANAGE,
        async () => "must-not-run",
      ),
    ).resolves.toEqual({
      status: "authorization-denied",
      reason: "stale-authorization",
    });
  });

  it("does not grant increased privileges to a stale Session", async () => {
    const fixture = await createFixture({
      role: "Viewer",
      membershipVersion: 5n,
    });
    await fixtureSql.query(
      `UPDATE organization_memberships
       SET role = 'Admin',
           authorization_version = authorization_version + 1,
           updated_at = $2
       WHERE id = $1::uuid`,
      [fixture.membershipId, now],
    );
    const callback = vi.fn(async () => "must-not-run");

    await expect(
      scope.runAuthorized(fixture.context, MEMBERSHIPS_MANAGE, callback),
    ).resolves.toEqual({
      status: "authorization-denied",
      reason: "stale-authorization",
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("denies a role reduction committed before the operation", async () => {
    const fixture = await createFixture({
      role: "Admin",
      membershipVersion: 11n,
    });
    await fixtureSql.query(
      `UPDATE organization_memberships
       SET role = 'Viewer',
           authorization_version = authorization_version + 1,
           updated_at = $2
       WHERE id = $1::uuid`,
      [fixture.membershipId, now],
    );
    const callback = vi.fn(async () => "must-not-run");

    await expect(
      scope.runAuthorized(fixture.context, MEMBERSHIPS_MANAGE, callback),
    ).resolves.toEqual({
      status: "authorization-denied",
      reason: "stale-authorization",
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("preserves authorized transaction failures as infrastructure errors", async () => {
    const fixture = await createFixture({ role: "Admin" });
    const transaction = vi.spyOn(lifecycle.client, "$transaction");
    transaction.mockRejectedValueOnce(
      new Error("synthetic authorized transaction failure"),
    );
    try {
      await expect(
        scope.runAuthorized(
          fixture.context,
          MEMBERSHIPS_MANAGE,
          async () => "must-not-run",
        ),
      ).rejects.toBeInstanceOf(TenantPersistenceError);
    } finally {
      transaction.mockRestore();
    }
  });

  it("fails closed for an invalid runtime PermissionRequirement", async () => {
    const fixture = await createFixture({ role: "Owner" });
    const callback = vi.fn(async () => "must-not-run");

    await expect(
      scope.runAuthorized(
        fixture.context,
        // @ts-expect-error Runtime callers can still provide corrupt input.
        Object.freeze({ requiredPermission: "*" }),
        callback,
      ),
    ).resolves.toEqual({
      status: "authorization-denied",
      reason: "invalid-permission-requirement",
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("rolls back callback writes after final Organization authority loss", async () => {
    const fixture = await createFixture({ role: "Viewer" });
    const operationStarted = deferred();
    const releaseOperation = deferred();
    const operation = scope.runAuthorized(
      fixture.context,
      ORGANIZATION_READ,
      async ({ repositories }) => {
        const write = await repositories.updateValue(
          fixture.resourceId,
          "must-roll-back",
        );
        operationStarted.resolve();
        await releaseOperation.promise;
        return write;
      },
    );
    await operationStarted.promise;

    await raceSql.query(
      "UPDATE organizations SET status = 'Inactive' WHERE id = $1::uuid",
      [fixture.organizationId],
    );
    releaseOperation.resolve();

    await expect(operation).resolves.toEqual({ status: "tenant-denied" });
    await expect(probeValue(fixture.resourceId)).resolves.toBe("initial");
  });
});
