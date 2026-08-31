import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { Clock } from "../../identity/application/clock.js";
import { isSessionExpired } from "../../identity/domain/session-policy.js";
import { validate, version } from "uuid";

import type { TenantContext } from "../application/tenant-authority.js";
import {
  TenantPersistenceError,
  type TenantPersistenceResult,
  type TenantPersistenceScope,
  TenantRepositoryScopeLease,
} from "../application/tenant-persistence-scope.js";

type TenantRepositoryFactory<Repositories> = (
  transaction: Prisma.TransactionClient,
  organizationId: string,
  lease: TenantRepositoryScopeLease,
) => Repositories;

type SessionAuthorityRow = Readonly<{
  currentMembershipAuthorizationVersion: bigint | null;
  currentOrganizationId: string | null;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  userId: string;
}>;

type MembershipAuthorityRow = Readonly<{
  membershipId: string;
  organizationId: string;
  status: string;
  userId: string;
}>;

const DENIED_RESULT: TenantPersistenceResult<never> = Object.freeze({
  status: "denied",
});

export const ORGANIZATION_AUTHORITY_LOCK_NAMESPACE =
  "bcm.organization-authority:";

class TenantAuthorityChangedDuringOperationError extends Error {
  constructor() {
    super("Tenant authority changed during the persistence operation.");
    this.name = "TenantAuthorityChangedDuringOperationError";
  }
}

function isUuidV7(identifier: string): boolean {
  return validate(identifier) && version(identifier) === 7;
}

export class PrismaTenantPersistenceScope<
  Repositories,
> implements TenantPersistenceScope<Repositories> {
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
    private readonly sessionIdleTimeoutMilliseconds: number,
    private readonly createRepositories: TenantRepositoryFactory<Repositories>,
  ) {
    if (
      !Number.isSafeInteger(sessionIdleTimeoutMilliseconds) ||
      sessionIdleTimeoutMilliseconds <= 0
    ) {
      throw new Error("A positive Session idle timeout is required.");
    }
  }

  async run<Result>(
    tenantContext: TenantContext,
    operation: (repositories: Repositories) => Promise<Result>,
  ): Promise<TenantPersistenceResult<Result>> {
    if (!this.hasValidIdentifiers(tenantContext)) {
      return DENIED_RESULT;
    }

    try {
      return await this.client.$transaction(async (transaction) => {
        if (
          !(await this.lockAndValidateAuthority(transaction, tenantContext))
        ) {
          return DENIED_RESULT;
        }

        const lease = new TenantRepositoryScopeLease();
        try {
          const repositories = this.createRepositories(
            transaction,
            tenantContext.organizationId,
            lease,
          );
          const value = await operation(repositories);

          if (
            !(await this.lockAndValidateAuthority(transaction, tenantContext))
          ) {
            throw new TenantAuthorityChangedDuringOperationError();
          }

          return Object.freeze({ status: "executed" as const, value });
        } finally {
          lease.close();
        }
      });
    } catch (error: unknown) {
      if (error instanceof TenantAuthorityChangedDuringOperationError) {
        return DENIED_RESULT;
      }
      if (error instanceof TenantPersistenceError) throw error;
      throw new TenantPersistenceError(error);
    }
  }

  private hasValidIdentifiers(context: TenantContext): boolean {
    return (
      isUuidV7(context.userId) &&
      isUuidV7(context.sessionId) &&
      isUuidV7(context.organizationId) &&
      isUuidV7(context.membershipId)
    );
  }

  private async lockAndValidateAuthority(
    transaction: Prisma.TransactionClient,
    context: TenantContext,
  ): Promise<boolean> {
    // Stable order: Session FOR UPDATE -> User FOR SHARE -> Membership FOR
    // SHARE -> Organization advisory lock -> tenant-owned rows. Session and
    // Membership mutations serialize on their rows. Organization mutations
    // must take the matching exclusive advisory lock because the runtime role
    // deliberately has SELECT-only access to organizations.
    const session = await this.lockSession(transaction, context);
    if (session === undefined || !this.isSessionAuthorized(session, context)) {
      return false;
    }
    if (!(await this.lockActiveUser(transaction, context.userId))) {
      return false;
    }

    const membership = await this.lockMembership(transaction, context);
    if (
      membership === undefined ||
      membership.status !== "Active" ||
      membership.userId !== context.userId ||
      membership.organizationId !== context.organizationId ||
      membership.membershipId !== context.membershipId
    ) {
      return false;
    }

    await this.lockOrganizationAuthority(transaction, context.organizationId);
    return this.isOrganizationActive(transaction, context.organizationId);
  }

  private async lockSession(
    transaction: Prisma.TransactionClient,
    context: TenantContext,
  ): Promise<SessionAuthorityRow | undefined> {
    const rows = await transaction.$queryRaw<SessionAuthorityRow[]>`
      SELECT
        session_row.user_id AS "userId",
        session_row.current_organization_id AS "currentOrganizationId",
        session_row.current_membership_authorization_version
          AS "currentMembershipAuthorizationVersion",
        session_row.expires_at AS "expiresAt",
        session_row.revoked_at AS "revokedAt",
        COALESCE(session_row.last_seen_at, session_row.created_at)
          AS "lastSeenAt"
      FROM sessions AS session_row
      WHERE session_row.id = ${context.sessionId}::uuid
        AND session_row.user_id = ${context.userId}::uuid
      FOR UPDATE OF session_row
    `;

    if (rows.length > 1) {
      throw new TenantPersistenceError(
        new Error("The Session authority lookup returned duplicate rows."),
      );
    }
    return rows[0];
  }

  private isSessionAuthorized(
    session: SessionAuthorityRow,
    context: TenantContext,
  ): boolean {
    return (
      session.userId === context.userId &&
      session.currentOrganizationId === context.organizationId &&
      session.currentMembershipAuthorizationVersion !== null &&
      session.currentMembershipAuthorizationVersion > 0n &&
      session.revokedAt === null &&
      !isSessionExpired(
        this.clock.now(),
        session.expiresAt,
        session.lastSeenAt,
        this.sessionIdleTimeoutMilliseconds,
      )
    );
  }

  private async lockActiveUser(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ status: string }>>`
      SELECT user_row.status
      FROM users AS user_row
      WHERE user_row.id = ${userId}::uuid
      FOR SHARE OF user_row
    `;

    if (rows.length > 1) {
      throw new TenantPersistenceError(
        new Error("The User authority lookup returned duplicate rows."),
      );
    }
    return rows[0]?.status === "Active";
  }

  private async lockMembership(
    transaction: Prisma.TransactionClient,
    context: TenantContext,
  ): Promise<MembershipAuthorityRow | undefined> {
    const rows = await transaction.$queryRaw<MembershipAuthorityRow[]>`
      SELECT
        membership.id AS "membershipId",
        membership.user_id AS "userId",
        membership.organization_id AS "organizationId",
        membership.status
      FROM organization_memberships AS membership
      WHERE membership.id = ${context.membershipId}::uuid
      FOR SHARE OF membership
    `;

    if (rows.length > 1) {
      throw new TenantPersistenceError(
        new Error("The Membership authority lookup returned duplicate rows."),
      );
    }
    return rows[0];
  }

  private async lockOrganizationAuthority(
    transaction: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS locked
      FROM pg_advisory_xact_lock_shared(
        hashtextextended(
          ${ORGANIZATION_AUTHORITY_LOCK_NAMESPACE} || ${organizationId}::text,
          0
        )
      )
    `;
  }

  private async isOrganizationActive(
    transaction: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ status: string }>>`
      SELECT organization.status
      FROM organizations AS organization
      WHERE organization.id = ${organizationId}::uuid
      LIMIT 2
    `;

    if (rows.length > 1) {
      throw new TenantPersistenceError(
        new Error("The Organization authority lookup returned duplicate rows."),
      );
    }
    return rows[0]?.status === "Active";
  }
}
