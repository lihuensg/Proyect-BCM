import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Clock } from "../../../src/identity/application/clock.js";
import { SessionPersistenceError } from "../../../src/identity/application/session-repository.js";
import {
  SessionCreationError,
  SessionService,
} from "../../../src/identity/application/session-service.js";
import type { SessionTokenService } from "../../../src/identity/application/session-token-service.js";
import { NodeSessionTokenService } from "../../../src/identity/infrastructure/node-session-token-service.js";
import { PrismaSessionRepository } from "../../../src/identity/infrastructure/prisma-session-repository.js";
import { loadServerConfig } from "../../../src/config/server-config.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import {
  assertSafeRuntimeDatabaseIdentity,
  UnsafeRuntimeDatabaseIdentityError,
} from "../../../src/infrastructure/database/runtime-database-identity.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";

class MutableClock implements Clock {
  constructor(public value: Date) {}
  now(): Date {
    return this.value;
  }
}

class SequenceTokenService implements SessionTokenService {
  constructor(private readonly tokens: string[]) {}
  generate(): string {
    const token = this.tokens.shift();
    if (token === undefined)
      throw new Error("No token remains in the test sequence.");
    return token;
  }
  digest(rawToken: string): Buffer {
    return new NodeSessionTokenService().digest(rawToken);
  }
  isValidFormat(rawToken: string): boolean {
    return new NodeSessionTokenService().isValidFormat(rawToken);
  }
}

describe("PostgreSQL session repository", () => {
  const config = loadServerConfig(process.env);
  const lifecycle = new PrismaClientLifecycle(config.database.runtimeUrl, {
    max: 4,
  });
  const fixtureSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });
  const adminSql = new Client({
    connectionString: process.env.BCM_TEST_ADMIN_DATABASE_URL,
  });
  const repository = new PrismaSessionRepository(lifecycle.client);
  const tokenService = new NodeSessionTokenService();

  async function createUser(
    status: "Active" | "Disabled" = "Active",
  ): Promise<string> {
    const id = generateUuidV7();
    const email = `${id}@session.test`;
    const now = new Date();
    await lifecycle.client.user.create({
      data: {
        id,
        email,
        emailNormalized: email,
        status,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }

  function service(
    clock: MutableClock,
    tokens: SessionTokenService = tokenService,
  ): SessionService {
    return new SessionService(
      repository,
      tokens,
      clock,
      generateUuidV7,
      config.session,
    );
  }

  beforeAll(async () => {
    await adminSql.connect();
    await fixtureSql.connect();
    await lifecycle.connect();
  });

  afterAll(async () => {
    await lifecycle.disconnect();
    await fixtureSql.end();
    await adminSql.end();
  });

  it("accepts the restricted runtime role and fails fast for an unsafe real identity", async () => {
    const role = await lifecycle.client.$queryRaw<
      Array<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        owns_database: boolean;
        owns_schema: boolean;
      }>
    >`
      SELECT
        role.rolsuper,
        role.rolbypassrls,
        database.datdba = role.oid AS owns_database,
        namespace.nspowner = role.oid AS owns_schema
      FROM pg_roles AS role
      JOIN pg_database AS database ON database.datname = current_database()
      JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
      WHERE role.rolname = current_user
    `;
    expect(role).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        owns_database: false,
        owns_schema: false,
      },
    ]);

    const adminUrl = process.env.BCM_TEST_ADMIN_DATABASE_URL;
    const migrationUrl = process.env.DIRECT_DATABASE_URL;
    const runtimeRole = process.env.BCM_TEST_RUNTIME_ROLE;
    if (
      adminUrl === undefined ||
      migrationUrl === undefined ||
      runtimeRole === undefined
    ) {
      throw new Error("Database identity test configuration is required.");
    }

    await expect(
      assertSafeRuntimeDatabaseIdentity(lifecycle.client, "unexpected-runtime"),
    ).rejects.toBeInstanceOf(UnsafeRuntimeDatabaseIdentityError);

    const unsafeLifecycle = new PrismaClientLifecycle(adminUrl);
    await expect(unsafeLifecycle.connect()).rejects.toBeInstanceOf(
      UnsafeRuntimeDatabaseIdentityError,
    );
    expect(unsafeLifecycle.connected).toBe(false);

    const schemaOwnerLifecycle = new PrismaClientLifecycle(migrationUrl);
    await expect(schemaOwnerLifecycle.connect()).rejects.toBeInstanceOf(
      UnsafeRuntimeDatabaseIdentityError,
    );

    const roleStatement = async (attribute: "BYPASSRLS" | "NOBYPASSRLS") => {
      const result = await adminSql.query<{ statement: string }>(
        `SELECT format('ALTER ROLE %I WITH ${attribute}', $1::text) AS statement`,
        [runtimeRole],
      );
      const statement = result.rows[0]?.statement;
      if (statement === undefined)
        throw new Error("Role statement was not built.");
      await adminSql.query(statement);
    };

    try {
      await roleStatement("BYPASSRLS");
      const bypassLifecycle = new PrismaClientLifecycle(
        config.database.runtimeUrl,
      );
      await expect(bypassLifecycle.connect()).rejects.toBeInstanceOf(
        UnsafeRuntimeDatabaseIdentityError,
      );
    } finally {
      await roleStatement("NOBYPASSRLS");
    }

    const currentDatabase = await adminSql.query<{
      current_database: string;
    }>("SELECT current_database()");
    const ownerDatabaseName = `${currentDatabase.rows[0]?.current_database ?? ""}_owner`;
    if (!/^bcm_soft_test_[a-z0-9]+_owner$/u.test(ownerDatabaseName)) {
      throw new Error("Unsafe database-owner test target.");
    }
    const createOwnerDatabase = await adminSql.query<{ statement: string }>(
      "SELECT format('CREATE DATABASE %I OWNER %I', $1::text, $2::text) AS statement",
      [ownerDatabaseName, runtimeRole],
    );
    const createStatement = createOwnerDatabase.rows[0]?.statement;
    if (createStatement === undefined)
      throw new Error("Database creation statement was not built.");
    const dropOwnerDatabase = await adminSql.query<{ statement: string }>(
      "SELECT format('DROP DATABASE %I WITH (FORCE)', $1::text) AS statement",
      [ownerDatabaseName],
    );
    const dropStatement = dropOwnerDatabase.rows[0]?.statement;
    if (dropStatement === undefined)
      throw new Error("Database cleanup statement was not built.");
    await adminSql.query(createStatement);

    try {
      const ownerUrl = new URL(config.database.runtimeUrl);
      ownerUrl.pathname = ownerDatabaseName;
      const ownerLifecycle = new PrismaClientLifecycle(ownerUrl.toString());
      await expect(ownerLifecycle.connect()).rejects.toBeInstanceOf(
        UnsafeRuntimeDatabaseIdentityError,
      );
    } finally {
      await adminSql.query(dropStatement);
    }
  }, 30_000);

  it("creates only a digest-backed session for an Active User and rejects Disabled", async () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const clock = new MutableClock(now);
    const activeUserId = await createUser();
    const created = await service(clock).createSession(activeUserId);
    const persisted = await lifecycle.client.session.findUniqueOrThrow({
      where: { id: created.sessionId },
    });

    expect(created.rawToken).toHaveLength(43);
    expect(Buffer.from(persisted.tokenHash)).toEqual(
      tokenService.digest(created.rawToken),
    );
    expect(persisted.tokenHash).toHaveLength(32);
    expect(persisted).not.toHaveProperty("rawToken");
    expect(persisted.createdAt).toEqual(now);
    expect(persisted.lastSeenAt).toEqual(now);
    expect(persisted.expiresAt).toEqual(
      new Date(now.getTime() + 12 * 60 * 60_000),
    );
    expect(persisted.currentOrganizationId).toBeNull();
    expect(persisted.currentMembershipAuthorizationVersion).toBeNull();

    const disabledUserId = await createUser("Disabled");
    await expect(
      service(clock).createSession(disabledUserId),
    ).rejects.toBeInstanceOf(SessionCreationError);
    expect(
      await lifecycle.client.session.count({
        where: { userId: disabledUserId },
      }),
    ).toBe(0);
  });

  it("retries only the real token-hash unique constraint", async () => {
    const clock = new MutableClock(new Date("2026-08-17T13:00:00.000Z"));
    const firstUserId = await createUser();
    const secondUserId = await createUser();
    const duplicateToken = "A".repeat(43);
    const replacementToken = "B".repeat(43);
    await service(
      clock,
      new SequenceTokenService([duplicateToken]),
    ).createSession(firstUserId);

    const created = await service(
      clock,
      new SequenceTokenService([duplicateToken, replacementToken]),
    ).createSession(secondUserId);
    expect(created.rawToken).toBe(replacementToken);

    await expect(
      repository.createForActiveUser({
        id: generateUuidV7(),
        tokenHash: tokenService.digest("C".repeat(43)),
        userId: "not-a-uuid",
        expiresAt: new Date(clock.value.getTime() + 60 * 60_000),
        lastSeenAt: clock.value,
        createdAt: clock.value,
      }),
    ).rejects.toBeInstanceOf(SessionPersistenceError);
  });

  it("validates lifecycle and User status without treating Organization selection as authority", async () => {
    const now = new Date("2026-08-17T14:00:00.000Z");
    const clock = new MutableClock(now);
    const userId = await createUser();
    const created = await service(clock).createSession(userId);

    await expect(
      service(clock).validateSession(created.rawToken),
    ).resolves.toMatchObject({
      status: "valid",
      userId,
      selectedOrganizationId: null,
      selectedMembershipAuthorizationVersion: null,
    });
    await expect(service(clock).validateSession("malformed")).resolves.toEqual({
      status: "invalid",
    });
    await expect(
      service(clock).validateSession("Z".repeat(43)),
    ).resolves.toEqual({ status: "invalid" });

    await lifecycle.client.user.update({
      where: { id: userId },
      data: { status: "Disabled", updatedAt: new Date() },
    });
    await expect(
      service(clock).validateSession(created.rawToken),
    ).resolves.toEqual({ status: "invalid" });

    const absoluteUserId = await createUser();
    const absolute = await service(clock).createSession(absoluteUserId);
    clock.value = absolute.expiresAt;
    await expect(
      service(clock).validateSession(absolute.rawToken),
    ).resolves.toEqual({ status: "invalid" });

    const idleUserId = await createUser();
    clock.value = now;
    const idle = await service(clock).createSession(idleUserId);
    clock.value = new Date(
      now.getTime() + config.session.idleTimeoutMilliseconds,
    );
    await expect(
      service(clock).validateSession(idle.rawToken),
    ).resolves.toEqual({ status: "invalid" });

    const selectedUserId = await createUser();
    const organizationId = generateUuidV7();
    await fixtureSql.query(
      `INSERT INTO organizations
        (id, name, status, timezone, created_at, updated_at)
       VALUES ($1::uuid, 'Session snapshot organization', 'Active',
               'America/Argentina/Buenos_Aires', $2, $2)`,
      [organizationId, now],
    );
    await fixtureSql.query(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status,
         authorization_version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Viewer', 'Suspended', 7, $4, $4)`,
      [generateUuidV7(), organizationId, selectedUserId, now],
    );
    const selectedToken = tokenService.generate();
    const selectedSessionId = generateUuidV7();
    await lifecycle.client.session.create({
      data: {
        id: selectedSessionId,
        tokenHash: new Uint8Array(tokenService.digest(selectedToken)),
        userId: selectedUserId,
        currentOrganizationId: organizationId,
        currentMembershipAuthorizationVersion: 7,
        expiresAt: new Date(now.getTime() + 60 * 60_000),
        lastSeenAt: now,
        createdAt: now,
      },
    });
    clock.value = now;
    await expect(
      service(clock).validateSession(selectedToken),
    ).resolves.toEqual({
      status: "valid",
      sessionId: selectedSessionId,
      userId: selectedUserId,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      selectedOrganizationId: organizationId,
      selectedMembershipAuthorizationVersion: 7n,
    });
  });

  it("touches atomically only when due and never revives or extends a terminal session", async () => {
    const now = new Date("2026-08-17T15:00:00.000Z");
    const clock = new MutableClock(now);
    const userId = await createUser();
    const created = await service(clock).createSession(userId);

    clock.value = new Date(
      now.getTime() + config.session.touchIntervalMilliseconds - 1,
    );
    await service(clock).validateSession(created.rawToken);
    expect(
      (
        await lifecycle.client.session.findUniqueOrThrow({
          where: { id: created.sessionId },
        })
      ).lastSeenAt,
    ).toEqual(now);

    clock.value = new Date(
      now.getTime() + config.session.touchIntervalMilliseconds,
    );
    const concurrent = await Promise.all(
      Array.from({ length: 6 }, () =>
        repository.touchLastSeenIfDue({
          sessionId: created.sessionId,
          now: clock.value,
          idleTimeoutMilliseconds: config.session.idleTimeoutMilliseconds,
          touchIntervalMilliseconds: config.session.touchIntervalMilliseconds,
        }),
      ),
    );
    expect(concurrent.filter(Boolean)).toHaveLength(1);
    const touched = await lifecycle.client.session.findUniqueOrThrow({
      where: { id: created.sessionId },
    });
    expect(touched.lastSeenAt).toEqual(clock.value);
    expect(touched.expiresAt).toEqual(created.expiresAt);

    const earlierTouch = new Date(
      clock.value.getTime() + config.session.touchIntervalMilliseconds,
    );
    const laterTouch = new Date(
      earlierTouch.getTime() + config.session.touchIntervalMilliseconds,
    );
    await Promise.all([
      repository.touchLastSeenIfDue({
        sessionId: created.sessionId,
        now: earlierTouch,
        idleTimeoutMilliseconds: config.session.idleTimeoutMilliseconds,
        touchIntervalMilliseconds: config.session.touchIntervalMilliseconds,
      }),
      repository.touchLastSeenIfDue({
        sessionId: created.sessionId,
        now: laterTouch,
        idleTimeoutMilliseconds: config.session.idleTimeoutMilliseconds,
        touchIntervalMilliseconds: config.session.touchIntervalMilliseconds,
      }),
    ]);
    expect(
      (
        await lifecycle.client.session.findUniqueOrThrow({
          where: { id: created.sessionId },
        })
      ).lastSeenAt,
    ).toEqual(laterTouch);

    await repository.revokeByTokenHash(
      tokenService.digest(created.rawToken),
      laterTouch,
    );
    expect(
      await repository.touchLastSeenIfDue({
        sessionId: created.sessionId,
        now: new Date(
          laterTouch.getTime() + config.session.touchIntervalMilliseconds,
        ),
        idleTimeoutMilliseconds: config.session.idleTimeoutMilliseconds,
        touchIntervalMilliseconds: config.session.touchIntervalMilliseconds,
      }),
    ).toBe(false);

    const idleExpiredUser = await createUser();
    clock.value = new Date("2026-08-17T17:00:00.000Z");
    const idleExpired = await service(clock).createSession(idleExpiredUser);
    const idleBoundary = new Date(
      clock.value.getTime() - config.session.idleTimeoutMilliseconds,
    );
    await lifecycle.client.session.update({
      where: { id: idleExpired.sessionId },
      data: { createdAt: idleBoundary, lastSeenAt: idleBoundary },
    });
    expect(
      await repository.touchLastSeenIfDue({
        sessionId: idleExpired.sessionId,
        now: clock.value,
        idleTimeoutMilliseconds: config.session.idleTimeoutMilliseconds,
        touchIntervalMilliseconds: config.session.touchIntervalMilliseconds,
      }),
    ).toBe(false);

    const absoluteExpiredUser = await createUser();
    const absoluteExpired =
      await service(clock).createSession(absoluteExpiredUser);
    const oldCreatedAt = new Date(
      clock.value.getTime() - config.session.absoluteLifetimeMilliseconds - 1,
    );
    await lifecycle.client.session.update({
      where: { id: absoluteExpired.sessionId },
      data: {
        createdAt: oldCreatedAt,
        lastSeenAt: new Date(clock.value.getTime() - 10 * 60_000),
        expiresAt: new Date(clock.value.getTime() - 1),
      },
    });
    expect(
      await repository.touchLastSeenIfDue({
        sessionId: absoluteExpired.sessionId,
        now: clock.value,
        idleTimeoutMilliseconds: config.session.idleTimeoutMilliseconds,
        touchIntervalMilliseconds: config.session.touchIntervalMilliseconds,
      }),
    ).toBe(false);
  });

  it("revokes individual and all User sessions idempotently without overwriting terminal facts", async () => {
    const now = new Date("2026-08-17T16:00:00.000Z");
    const clock = new MutableClock(now);
    const userId = await createUser();
    const first = await service(clock).createSession(userId);
    const second = await service(clock).createSession(userId);

    clock.value = new Date(now.getTime() + 1_000);
    await service(clock).revokeSession(first.rawToken);
    await service(clock).revokeSession(first.rawToken);
    await service(clock).revokeSession("Q".repeat(43));
    expect(
      (
        await lifecycle.client.session.findUniqueOrThrow({
          where: { id: first.sessionId },
        })
      ).revokedAt,
    ).toEqual(clock.value);
    await expect(
      service(clock).validateSession(first.rawToken),
    ).resolves.toEqual({ status: "invalid" });

    clock.value = new Date(now.getTime() + 2_000);
    await service(clock).revokeAllSessionsForUser(userId);
    await service(clock).revokeAllSessionsForUser(userId);
    const sessions = await lifecycle.client.session.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    expect(
      sessions.find((session) => session.id === first.sessionId)?.revokedAt,
    ).toEqual(new Date(now.getTime() + 1_000));
    expect(
      sessions.find((session) => session.id === second.sessionId)?.revokedAt,
    ).toEqual(clock.value);
  });
});
