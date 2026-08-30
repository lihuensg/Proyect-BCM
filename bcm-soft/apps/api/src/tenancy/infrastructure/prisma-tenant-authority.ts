import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { Clock } from "../../identity/application/clock.js";
import { isSessionExpired } from "../../identity/domain/session-policy.js";
import { validate, version } from "uuid";

import type { AuthenticatedIdentity } from "../application/authenticated-identity.js";
import {
  FailClosedTenantAuthorityResolver,
  type MembershipAuthorityStatus,
  type OrganizationAuthorityStatus,
  type TenantAuthorityResolution,
  type TenantAuthorityResolver,
  type TenantAuthoritySnapshot,
  type TenantAuthoritySnapshotProvider,
  TenantAuthorityPersistenceError,
  type TenantMembershipAuthority,
} from "../application/tenant-authority.js";

type SessionLock = "share" | "update";

type SessionAuthorityRow = Readonly<{
  currentMembershipAuthorizationVersion: bigint | null;
  currentOrganizationId: string | null;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  userId: string;
  userStatus: string;
}>;

type MembershipAuthorityRow = Readonly<{
  membershipId: string;
  membershipStatus: string;
  organizationId: string;
  organizationStatus: string;
  userId: string;
}>;

const UNAVAILABLE_SNAPSHOT: TenantAuthoritySnapshot = Object.freeze({
  status: "unavailable",
});
const DENIED_RESOLUTION: TenantAuthorityResolution = Object.freeze({
  status: "denied",
});

class TenantAuthorityDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAuthorityDataIntegrityError";
  }
}

function isUuidV7(identifier: string): boolean {
  return validate(identifier) && version(identifier) === 7;
}

function mapMembershipStatus(status: string): MembershipAuthorityStatus {
  switch (status) {
    case "Active":
    case "Suspended":
    case "Revoked":
      return status;
    default:
      throw new TenantAuthorityDataIntegrityError(
        "The Membership authority status is not supported.",
      );
  }
}

function mapOrganizationStatus(status: string): OrganizationAuthorityStatus {
  switch (status) {
    case "Active":
    case "Inactive":
      return status;
    default:
      throw new TenantAuthorityDataIntegrityError(
        "The Organization authority status is not supported.",
      );
  }
}

function mapMembership(row: MembershipAuthorityRow): TenantMembershipAuthority {
  return Object.freeze({
    membershipId: row.membershipId,
    userId: row.userId,
    organizationId: row.organizationId,
    membershipStatus: mapMembershipStatus(row.membershipStatus),
    organizationStatus: mapOrganizationStatus(row.organizationStatus),
  });
}

function staticSnapshotProvider(
  snapshot: TenantAuthoritySnapshot,
): TenantAuthoritySnapshotProvider {
  return {
    loadFor: () => Promise.resolve(snapshot),
  };
}

async function resolveSnapshot(
  identity: AuthenticatedIdentity,
  snapshot: TenantAuthoritySnapshot,
): Promise<TenantAuthorityResolution> {
  return new FailClosedTenantAuthorityResolver(
    staticSnapshotProvider(snapshot),
  ).resolve(identity);
}

export class PrismaTenantAuthorityAdapter
  implements TenantAuthoritySnapshotProvider, TenantAuthorityResolver
{
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
    private readonly sessionIdleTimeoutMilliseconds: number,
  ) {
    if (
      !Number.isSafeInteger(sessionIdleTimeoutMilliseconds) ||
      sessionIdleTimeoutMilliseconds <= 0
    ) {
      throw new Error("A positive Session idle timeout is required.");
    }
  }

  async loadFor(
    authenticatedIdentity: AuthenticatedIdentity,
  ): Promise<TenantAuthoritySnapshot> {
    if (!this.isValidIdentity(authenticatedIdentity)) {
      return UNAVAILABLE_SNAPSHOT;
    }

    return this.withPersistenceBoundary((transaction) =>
      this.loadSnapshot(transaction, authenticatedIdentity, "share"),
    );
  }

  async resolve(
    authenticatedIdentity: AuthenticatedIdentity,
  ): Promise<TenantAuthorityResolution> {
    if (!this.isValidIdentity(authenticatedIdentity)) {
      return DENIED_RESOLUTION;
    }

    return this.withPersistenceBoundary(async (transaction) => {
      const snapshot = await this.loadSnapshot(
        transaction,
        authenticatedIdentity,
        "update",
      );
      const initialResolution = await resolveSnapshot(
        authenticatedIdentity,
        snapshot,
      );

      if (initialResolution.status !== "auto-selection-required") {
        return initialResolution;
      }

      await this.persistAutoSelection(
        transaction,
        authenticatedIdentity,
        initialResolution.candidate.organizationId,
        initialResolution.candidate.membershipId,
      );

      const confirmedSnapshot = await this.loadSnapshot(
        transaction,
        authenticatedIdentity,
        "update",
      );
      const confirmedResolution = await resolveSnapshot(
        authenticatedIdentity,
        confirmedSnapshot,
      );

      return confirmedResolution.status === "auto-selection-required"
        ? DENIED_RESOLUTION
        : confirmedResolution;
    });
  }

  private isValidIdentity(identity: AuthenticatedIdentity): boolean {
    return isUuidV7(identity.userId) && isUuidV7(identity.sessionId);
  }

  private async withPersistenceBoundary<Result>(
    work: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.client.$transaction(work);
    } catch (error: unknown) {
      throw new TenantAuthorityPersistenceError(error);
    }
  }

  private async loadSnapshot(
    transaction: Prisma.TransactionClient,
    identity: AuthenticatedIdentity,
    sessionLock: SessionLock,
  ): Promise<TenantAuthoritySnapshot> {
    // Lock order for this capability is Session first, then bounded
    // Membership rows ordered by id. Organization is revalidated
    // optimistically because the least-privileged runtime role is read-only
    // for organizations and therefore cannot acquire a row lock there.
    const session = await this.loadSession(transaction, identity, sessionLock);
    if (session === undefined) return UNAVAILABLE_SNAPSHOT;

    const hasOrganization = session.currentOrganizationId !== null;
    const hasVersion = session.currentMembershipAuthorizationVersion !== null;
    if (
      hasOrganization !== hasVersion ||
      (session.currentMembershipAuthorizationVersion !== null &&
        session.currentMembershipAuthorizationVersion < 1n)
    ) {
      throw new TenantAuthorityDataIntegrityError(
        "The Session tenant selection is structurally inconsistent.",
      );
    }

    const now = this.clock.now();
    if (
      session.userId !== identity.userId ||
      session.userStatus !== "Active" ||
      session.revokedAt !== null ||
      isSessionExpired(
        now,
        session.expiresAt,
        session.lastSeenAt,
        this.sessionIdleTimeoutMilliseconds,
      )
    ) {
      return UNAVAILABLE_SNAPSHOT;
    }

    const memberships =
      session.currentOrganizationId === null
        ? await this.loadAuthorizedCandidates(transaction, identity.userId)
        : await this.loadSelectedMembership(
            transaction,
            identity.userId,
            session.currentOrganizationId,
          );

    return Object.freeze({
      status: "available",
      selectedOrganizationId: session.currentOrganizationId,
      memberships: Object.freeze(memberships.map(mapMembership)),
    });
  }

  private async loadSession(
    transaction: Prisma.TransactionClient,
    identity: AuthenticatedIdentity,
    sessionLock: SessionLock,
  ): Promise<SessionAuthorityRow | undefined> {
    const sessions =
      sessionLock === "update"
        ? await transaction.$queryRaw<SessionAuthorityRow[]>`
            SELECT
              session_row.user_id AS "userId",
              session_row.current_organization_id AS "currentOrganizationId",
              session_row.current_membership_authorization_version
                AS "currentMembershipAuthorizationVersion",
              session_row.expires_at AS "expiresAt",
              session_row.revoked_at AS "revokedAt",
              COALESCE(session_row.last_seen_at, session_row.created_at)
                AS "lastSeenAt",
              user_row.status AS "userStatus"
            FROM sessions AS session_row
            JOIN users AS user_row ON user_row.id = session_row.user_id
            WHERE session_row.id = ${identity.sessionId}::uuid
              AND session_row.user_id = ${identity.userId}::uuid
            FOR UPDATE OF session_row
            FOR SHARE OF user_row
          `
        : await transaction.$queryRaw<SessionAuthorityRow[]>`
            SELECT
              session_row.user_id AS "userId",
              session_row.current_organization_id AS "currentOrganizationId",
              session_row.current_membership_authorization_version
                AS "currentMembershipAuthorizationVersion",
              session_row.expires_at AS "expiresAt",
              session_row.revoked_at AS "revokedAt",
              COALESCE(session_row.last_seen_at, session_row.created_at)
                AS "lastSeenAt",
              user_row.status AS "userStatus"
            FROM sessions AS session_row
            JOIN users AS user_row ON user_row.id = session_row.user_id
            WHERE session_row.id = ${identity.sessionId}::uuid
              AND session_row.user_id = ${identity.userId}::uuid
            FOR SHARE OF session_row, user_row
          `;

    if (sessions.length > 1) {
      throw new TenantAuthorityDataIntegrityError(
        "The Session authority lookup returned duplicate rows.",
      );
    }

    return sessions[0];
  }

  private async loadAuthorizedCandidates(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<MembershipAuthorityRow[]> {
    return transaction.$queryRaw<MembershipAuthorityRow[]>`
      SELECT
        membership.id AS "membershipId",
        membership.user_id AS "userId",
        membership.organization_id AS "organizationId",
        membership.status AS "membershipStatus",
        organization.status AS "organizationStatus"
      FROM organization_memberships AS membership
      JOIN organizations AS organization
        ON organization.id = membership.organization_id
      WHERE membership.user_id = ${userId}::uuid
        AND membership.status = 'Active'
        AND organization.status = 'Active'
      ORDER BY membership.id
      LIMIT 2
      FOR SHARE OF membership
    `;
  }

  private async loadSelectedMembership(
    transaction: Prisma.TransactionClient,
    userId: string,
    organizationId: string,
  ): Promise<MembershipAuthorityRow[]> {
    return transaction.$queryRaw<MembershipAuthorityRow[]>`
      SELECT
        membership.id AS "membershipId",
        membership.user_id AS "userId",
        membership.organization_id AS "organizationId",
        membership.status AS "membershipStatus",
        organization.status AS "organizationStatus"
      FROM organization_memberships AS membership
      JOIN organizations AS organization
        ON organization.id = membership.organization_id
      WHERE membership.user_id = ${userId}::uuid
        AND membership.organization_id = ${organizationId}::uuid
      ORDER BY membership.id
      LIMIT 2
      FOR SHARE OF membership
    `;
  }

  private async persistAutoSelection(
    transaction: Prisma.TransactionClient,
    identity: AuthenticatedIdentity,
    organizationId: string,
    membershipId: string,
  ): Promise<void> {
    const now = this.clock.now();
    const idleBoundary = new Date(
      now.getTime() - this.sessionIdleTimeoutMilliseconds,
    );
    const updated = await transaction.$executeRaw`
      UPDATE sessions AS session_row
      SET current_organization_id = membership.organization_id,
          current_membership_authorization_version =
            membership.authorization_version
      FROM organization_memberships AS membership
      JOIN organizations AS organization
        ON organization.id = membership.organization_id
      WHERE session_row.id = ${identity.sessionId}::uuid
        AND session_row.user_id = ${identity.userId}::uuid
        AND session_row.current_organization_id IS NULL
        AND session_row.current_membership_authorization_version IS NULL
        AND session_row.revoked_at IS NULL
        AND session_row.expires_at > ${now}
        AND COALESCE(session_row.last_seen_at, session_row.created_at)
          > ${idleBoundary}
        AND membership.id = ${membershipId}::uuid
        AND membership.user_id = session_row.user_id
        AND membership.organization_id = ${organizationId}::uuid
        AND membership.status = 'Active'
        AND organization.status = 'Active'
        AND EXISTS (
          SELECT 1
          FROM users AS active_user
          WHERE active_user.id = session_row.user_id
            AND active_user.status = 'Active'
        )
        AND 1 = (
          SELECT count(*)
          FROM (
            SELECT authorized_membership.id
            FROM organization_memberships AS authorized_membership
            JOIN organizations AS authorized_organization
              ON authorized_organization.id =
                authorized_membership.organization_id
            WHERE authorized_membership.user_id = session_row.user_id
              AND authorized_membership.status = 'Active'
              AND authorized_organization.status = 'Active'
            LIMIT 2
          ) AS bounded_authority_candidates
        )
    `;

    if (updated > 1) {
      throw new TenantAuthorityDataIntegrityError(
        "The Session auto-selection updated multiple rows.",
      );
    }
  }
}
