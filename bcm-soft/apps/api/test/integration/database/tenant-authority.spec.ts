import { randomBytes } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadServerConfig } from "../../../src/config/server-config.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import type { AuthenticatedIdentity } from "../../../src/tenancy/application/authenticated-identity.js";
import { TenantAuthorityPersistenceError } from "../../../src/tenancy/application/tenant-authority.js";
import { PrismaTenantAuthorityAdapter } from "../../../src/tenancy/infrastructure/prisma-tenant-authority.js";

type MembershipStatus = "Active" | "Suspended" | "Revoked";
type OrganizationStatus = "Active" | "Inactive";

type AuthorityFixture = Readonly<{
  identity: AuthenticatedIdentity;
  membershipId: string;
  organizationId: string;
}>;

class MutableClock {
  constructor(public value: Date) {}
  now(): Date {
    return this.value;
  }
}

describe("PostgreSQL tenant authority adapter", () => {
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
  const adapter = new PrismaTenantAuthorityAdapter(
    lifecycle.client,
    clock,
    config.session.idleTimeoutMilliseconds,
  );

  async function createUser(
    status: "Active" | "Disabled" = "Active",
  ): Promise<string> {
    const userId = generateUuidV7();
    const email = `${userId}@tenant-authority.test`;
    await fixtureSql.query(
      `INSERT INTO users
        (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $2, $3, $4, $4)`,
      [userId, email, status, now],
    );
    return userId;
  }

  async function createOrganization(
    status: OrganizationStatus = "Active",
  ): Promise<string> {
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
    authorizationVersion = 1n,
  ): Promise<string> {
    const membershipId = generateUuidV7();
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

  async function createSession(
    userId: string,
    options: Readonly<{
      createdAt?: Date;
      currentMembershipAuthorizationVersion?: bigint | null;
      currentOrganizationId?: string | null;
      expiresAt?: Date;
      lastSeenAt?: Date;
      revokedAt?: Date | null;
    }> = {},
  ): Promise<string> {
    const sessionId = generateUuidV7();
    const createdAt = options.createdAt ?? now;
    await fixtureSql.query(
      `INSERT INTO sessions
        (id, token_hash, user_id, current_organization_id,
         current_membership_authorization_version, expires_at, revoked_at,
         last_seen_at, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9)`,
      [
        sessionId,
        randomBytes(32),
        userId,
        options.currentOrganizationId ?? null,
        options.currentMembershipAuthorizationVersion?.toString() ?? null,
        options.expiresAt ?? new Date(now.getTime() + 60 * 60_000),
        options.revokedAt ?? null,
        options.lastSeenAt ?? createdAt,
        createdAt,
      ],
    );
    return sessionId;
  }

  async function createAuthorityFixture(
    options: Readonly<{
      authorizationVersion?: bigint;
      membershipStatus?: MembershipStatus;
      organizationStatus?: OrganizationStatus;
      selected?: boolean;
    }> = {},
  ): Promise<AuthorityFixture> {
    const userId = await createUser();
    const organizationId = await createOrganization(options.organizationStatus);
    const authorizationVersion = options.authorizationVersion ?? 1n;
    const membershipId = await createMembership(
      userId,
      organizationId,
      options.membershipStatus,
      authorizationVersion,
    );
    const sessionId = await createSession(userId, {
      currentOrganizationId: options.selected ? organizationId : null,
      currentMembershipAuthorizationVersion: options.selected
        ? authorizationVersion
        : null,
    });
    return {
      identity: Object.freeze({ userId, sessionId }),
      membershipId,
      organizationId,
    };
  }

  async function commitAuthorityChangeWhileResolving(
    identity: AuthenticatedIdentity,
    change: () => Promise<void>,
  ) {
    await raceSql.query("BEGIN");
    try {
      await change();
      const resolution = adapter.resolve(identity);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await raceSql.query("COMMIT");
      return await resolution;
    } catch (error: unknown) {
      await raceSql.query("ROLLBACK");
      throw error;
    }
  }

  beforeAll(async () => {
    await fixtureSql.connect();
    await raceSql.connect();
    await lifecycle.connect();
  });

  afterAll(async () => {
    await lifecycle.disconnect();
    await raceSql.end();
    await fixtureSql.end();
  });

  it("distinguishes unavailable authority from an infrastructure failure", async () => {
    const missingIdentity = Object.freeze({
      userId: generateUuidV7(),
      sessionId: generateUuidV7(),
    });

    await expect(adapter.loadFor(missingIdentity)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(
      adapter.resolve({ userId: "not-a-uuid", sessionId: "not-a-uuid" }),
    ).resolves.toEqual({ status: "denied" });

    const transaction = vi.spyOn(lifecycle.client, "$transaction");
    transaction.mockRejectedValueOnce(new Error("synthetic unavailable DB"));
    try {
      await expect(adapter.loadFor(missingIdentity)).rejects.toBeInstanceOf(
        TenantAuthorityPersistenceError,
      );
    } finally {
      transaction.mockRestore();
    }
  });

  it("denies zero candidates without changing Session selection", async () => {
    const userId = await createUser();
    const sessionId = await createSession(userId);
    const identity = Object.freeze({ userId, sessionId });

    await expect(adapter.resolve(identity)).resolves.toEqual({
      status: "denied",
    });
    const session = await lifecycle.client.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.currentOrganizationId).toBeNull();
    expect(session.currentMembershipAuthorizationVersion).toBeNull();
  });

  it("atomically persists and confirms exactly one authorized candidate", async () => {
    const fixture = await createAuthorityFixture({
      authorizationVersion: 7n,
    });
    const membershipBefore =
      await lifecycle.client.organizationMembership.findUniqueOrThrow({
        where: { id: fixture.membershipId },
      });
    const organizationBefore =
      await lifecycle.client.organization.findUniqueOrThrow({
        where: { id: fixture.organizationId },
      });

    await expect(adapter.resolve(fixture.identity)).resolves.toMatchObject({
      status: "resolved",
      context: {
        userId: fixture.identity.userId,
        sessionId: fixture.identity.sessionId,
        organizationId: fixture.organizationId,
        membershipId: fixture.membershipId,
      },
    });

    const session = await lifecycle.client.session.findUniqueOrThrow({
      where: { id: fixture.identity.sessionId },
    });
    expect(session.currentOrganizationId).toBe(fixture.organizationId);
    expect(session.currentMembershipAuthorizationVersion).toBe(7n);
    await expect(
      lifecycle.client.organizationMembership.findUniqueOrThrow({
        where: { id: fixture.membershipId },
      }),
    ).resolves.toEqual(membershipBefore);
    await expect(
      lifecycle.client.organization.findUniqueOrThrow({
        where: { id: fixture.organizationId },
      }),
    ).resolves.toEqual(organizationBefore);
  });

  it("requires selection for two candidates and persists no default", async () => {
    const userId = await createUser();
    const firstOrganizationId = await createOrganization();
    const secondOrganizationId = await createOrganization();
    await createMembership(userId, firstOrganizationId);
    await createMembership(userId, secondOrganizationId);
    const sessionId = await createSession(userId);

    await expect(
      adapter.resolve(Object.freeze({ userId, sessionId })),
    ).resolves.toEqual({ status: "selection-required" });
    const session = await lifecycle.client.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.currentOrganizationId).toBeNull();
    expect(session.currentMembershipAuthorizationVersion).toBeNull();
  });

  it.each(["Suspended", "Revoked"] as const)(
    "denies a %s Membership",
    async (membershipStatus) => {
      const fixture = await createAuthorityFixture({ membershipStatus });

      await expect(adapter.resolve(fixture.identity)).resolves.toEqual({
        status: "denied",
      });
    },
  );

  it("denies an Inactive Organization", async () => {
    const fixture = await createAuthorityFixture({
      organizationStatus: "Inactive",
    });

    await expect(adapter.resolve(fixture.identity)).resolves.toEqual({
      status: "denied",
    });
  });

  it("resolves a valid existing server-side selection", async () => {
    const fixture = await createAuthorityFixture({
      authorizationVersion: 11n,
      selected: true,
    });

    await expect(adapter.resolve(fixture.identity)).resolves.toMatchObject({
      status: "resolved",
      context: {
        organizationId: fixture.organizationId,
        membershipId: fixture.membershipId,
      },
    });
  });

  it("denies an invalid selected tenant without falling back to valid B", async () => {
    const selected = await createAuthorityFixture({
      membershipStatus: "Suspended",
      selected: true,
    });
    const organizationBId = await createOrganization();
    await createMembership(selected.identity.userId, organizationBId);

    await expect(adapter.resolve(selected.identity)).resolves.toEqual({
      status: "denied",
    });
    const session = await lifecycle.client.session.findUniqueOrThrow({
      where: { id: selected.identity.sessionId },
    });
    expect(session.currentOrganizationId).toBe(selected.organizationId);
  });

  it("fails closed for another User's Membership and Session/User mismatch", async () => {
    const sessionUserId = await createUser();
    const otherUserId = await createUser();
    const organizationId = await createOrganization();
    await createMembership(otherUserId, organizationId);
    const sessionId = await createSession(sessionUserId);

    await expect(
      adapter.resolve(Object.freeze({ userId: sessionUserId, sessionId })),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      adapter.resolve(Object.freeze({ userId: otherUserId, sessionId })),
    ).resolves.toEqual({ status: "denied" });
  });

  it("denies revoked, absolute-expired, idle-expired, and Disabled User sessions", async () => {
    const activeUserId = await createUser();
    const revokedSessionId = await createSession(activeUserId, {
      revokedAt: now,
    });
    const expiredCreatedAt = new Date(now.getTime() - 2 * 60 * 60_000);
    const expiredSessionId = await createSession(activeUserId, {
      createdAt: expiredCreatedAt,
      expiresAt: new Date(now.getTime() - 60 * 60_000),
      lastSeenAt: expiredCreatedAt,
    });
    const idleCreatedAt = new Date(
      now.getTime() - config.session.idleTimeoutMilliseconds,
    );
    const idleSessionId = await createSession(activeUserId, {
      createdAt: idleCreatedAt,
      lastSeenAt: idleCreatedAt,
    });
    const disabledUserId = await createUser("Disabled");
    const disabledSessionId = await createSession(disabledUserId);

    for (const identity of [
      { userId: activeUserId, sessionId: revokedSessionId },
      { userId: activeUserId, sessionId: expiredSessionId },
      { userId: activeUserId, sessionId: idleSessionId },
      { userId: disabledUserId, sessionId: disabledSessionId },
    ]) {
      await expect(adapter.resolve(Object.freeze(identity))).resolves.toEqual({
        status: "denied",
      });
    }
  });

  it("serializes concurrent auto-selection into one consistent selection", async () => {
    const fixture = await createAuthorityFixture({
      authorizationVersion: 13n,
    });
    const competingAdapter = new PrismaTenantAuthorityAdapter(
      lifecycle.client,
      clock,
      config.session.idleTimeoutMilliseconds,
    );

    const resolutions = await Promise.all([
      adapter.resolve(fixture.identity),
      competingAdapter.resolve(fixture.identity),
    ]);

    expect(resolutions).toEqual([
      expect.objectContaining({ status: "resolved" }),
      expect.objectContaining({ status: "resolved" }),
    ]);
    const session = await lifecycle.client.session.findUniqueOrThrow({
      where: { id: fixture.identity.sessionId },
    });
    expect(session.currentOrganizationId).toBe(fixture.organizationId);
    expect(session.currentMembershipAuthorizationVersion).toBe(13n);
  });

  it.each(["Suspended", "Revoked"] as const)(
    "does not resolve when Membership becomes %s during resolution",
    async (membershipStatus) => {
      const fixture = await createAuthorityFixture();
      const resolution = await commitAuthorityChangeWhileResolving(
        fixture.identity,
        async () => {
          await raceSql.query(
            `UPDATE organization_memberships
             SET status = $2,
                 authorization_version = authorization_version + 1,
                 revoked_at = CASE
                   WHEN $2 = 'Revoked' THEN $3::timestamptz
                   ELSE NULL::timestamptz
                 END,
                 updated_at = $3
             WHERE id = $1::uuid`,
            [fixture.membershipId, membershipStatus, now],
          );
        },
      );

      expect(resolution).toEqual({ status: "denied" });
    },
  );

  it("does not resolve when Organization becomes Inactive during resolution", async () => {
    const fixture = await createAuthorityFixture();
    const resolution = await commitAuthorityChangeWhileResolving(
      fixture.identity,
      async () => {
        await raceSql.query(
          `UPDATE organizations
           SET status = 'Inactive', updated_at = $2
           WHERE id = $1::uuid`,
          [fixture.organizationId, now],
        );
      },
    );

    expect(resolution).toEqual({ status: "denied" });
  });

  it("does not resolve when Session is revoked during resolution", async () => {
    const fixture = await createAuthorityFixture();
    const resolution = await commitAuthorityChangeWhileResolving(
      fixture.identity,
      async () => {
        await raceSql.query(
          `UPDATE sessions
           SET revoked_at = $2
           WHERE id = $1::uuid`,
          [fixture.identity.sessionId, now],
        );
      },
    );

    expect(resolution).toEqual({ status: "denied" });
    const session = await lifecycle.client.session.findUniqueOrThrow({
      where: { id: fixture.identity.sessionId },
    });
    expect(session.currentOrganizationId).toBeNull();
    expect(session.currentMembershipAuthorizationVersion).toBeNull();
  });
});
