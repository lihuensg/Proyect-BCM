import type { Prisma } from "../../generated/prisma/client.js";
import type {
  SessionAuthorizationSelection,
  SessionAuthorizationSnapshotProvider,
} from "../../identity/application/session-replacement.js";
import {
  isAuthorizationVersion,
  isMembershipRole,
} from "../application/authorization.js";
import { ORGANIZATION_AUTHORITY_LOCK_NAMESPACE } from "./prisma-tenant-persistence-scope.js";

const UNSELECTED = Object.freeze({
  organizationId: null,
  authorizationVersion: null,
});

export class PrismaSessionAuthorizationSnapshot implements SessionAuthorizationSnapshotProvider {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async resolveSelected(
    userId: string,
    organizationId: string | null,
  ): Promise<SessionAuthorizationSelection> {
    if (organizationId === null) return UNSELECTED;
    const memberships = await this.transaction.$queryRaw<
      Array<{ status: string; role: string; authorizationVersion: bigint }>
    >`
      SELECT status, role, authorization_version AS "authorizationVersion"
      FROM organization_memberships
      WHERE user_id = ${userId}::uuid AND organization_id = ${organizationId}::uuid
      FOR SHARE
    `;
    const membership = memberships[0];
    if (
      membership === undefined ||
      membership.status !== "Active" ||
      !isMembershipRole(membership.role) ||
      !isAuthorizationVersion(membership.authorizationVersion)
    )
      return UNSELECTED;
    await this.transaction.$queryRaw`
      SELECT 1 FROM pg_advisory_xact_lock_shared(hashtextextended(${ORGANIZATION_AUTHORITY_LOCK_NAMESPACE} || ${organizationId}::text, 0))
    `;
    const organizations = await this.transaction.$queryRaw<
      Array<{ status: string }>
    >`SELECT status FROM organizations WHERE id = ${organizationId}::uuid`;
    return organizations[0]?.status === "Active"
      ? {
          organizationId,
          authorizationVersion: membership.authorizationVersion,
        }
      : UNSELECTED;
  }
}
