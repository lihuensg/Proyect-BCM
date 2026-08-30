import type { AuthenticatedIdentity } from "./authenticated-identity.js";

const TENANT_CONTEXT_AUTHORITY = Symbol("TenantContextAuthority");

export type MembershipAuthorityStatus = "Active" | "Suspended" | "Revoked";
export type OrganizationAuthorityStatus = "Active" | "Inactive";

export type TenantContext = Readonly<{
  userId: string;
  sessionId: string;
  organizationId: string;
  membershipId: string;
  [TENANT_CONTEXT_AUTHORITY]: true;
}>;

// This tuple is a fixed authority relationship. Re-parenting requires revoking
// the existing Membership and creating or activating a different one.
export type TenantMembershipAuthority = Readonly<{
  membershipId: string;
  userId: string;
  organizationId: string;
  membershipStatus: MembershipAuthorityStatus;
  organizationStatus: OrganizationAuthorityStatus;
}>;

export type TenantAuthoritySnapshot =
  | Readonly<{ status: "unavailable" }>
  | Readonly<{
      status: "available";
      selectedOrganizationId: string | null;
      memberships: readonly TenantMembershipAuthority[];
    }>;

export type TenantSelectionCandidate = Readonly<{
  organizationId: string;
  membershipId: string;
}>;

export type TenantAuthorityResolution =
  | Readonly<{ status: "resolved"; context: TenantContext }>
  | Readonly<{
      status: "auto-selection-required";
      candidate: TenantSelectionCandidate;
    }>
  | Readonly<{ status: "selection-required" }>
  | Readonly<{ status: "denied" }>;

export interface TenantAuthoritySnapshotProvider {
  // The future adapter must derive selection from server-side Session state;
  // an Organization identifier supplied by Presentation is never authority.
  loadFor(
    authenticatedIdentity: AuthenticatedIdentity,
  ): Promise<TenantAuthoritySnapshot>;
}

export interface TenantAuthorityResolver {
  resolve(
    authenticatedIdentity: AuthenticatedIdentity,
  ): Promise<TenantAuthorityResolution>;
}

const DENIED_RESOLUTION: TenantAuthorityResolution = Object.freeze({
  status: "denied",
});
const SELECTION_REQUIRED_RESOLUTION: TenantAuthorityResolution = Object.freeze({
  status: "selection-required",
});

function isAuthorizedMembership(
  membership: TenantMembershipAuthority,
): boolean {
  return (
    membership.membershipStatus === "Active" &&
    membership.organizationStatus === "Active"
  );
}

function hasDuplicateAuthorityEntries(
  memberships: readonly TenantMembershipAuthority[],
): boolean {
  const membershipIds = new Set<string>();
  const organizationIds = new Set<string>();

  for (const membership of memberships) {
    if (
      membershipIds.has(membership.membershipId) ||
      organizationIds.has(membership.organizationId)
    ) {
      return true;
    }

    membershipIds.add(membership.membershipId);
    organizationIds.add(membership.organizationId);
  }

  return false;
}

function createTenantContext(
  identity: AuthenticatedIdentity,
  membership: TenantMembershipAuthority,
): TenantContext {
  return Object.freeze({
    userId: identity.userId,
    sessionId: identity.sessionId,
    organizationId: membership.organizationId,
    membershipId: membership.membershipId,
    [TENANT_CONTEXT_AUTHORITY]: true as const,
  });
}

export class FailClosedTenantAuthorityResolver implements TenantAuthorityResolver {
  constructor(private readonly snapshots: TenantAuthoritySnapshotProvider) {}

  async resolve(
    authenticatedIdentity: AuthenticatedIdentity,
  ): Promise<TenantAuthorityResolution> {
    const snapshot = await this.snapshots.loadFor(authenticatedIdentity);
    if (snapshot.status === "unavailable") return DENIED_RESOLUTION;

    if (
      hasDuplicateAuthorityEntries(snapshot.memberships) ||
      snapshot.memberships.some(
        (membership) => membership.userId !== authenticatedIdentity.userId,
      )
    ) {
      return DENIED_RESOLUTION;
    }

    if (snapshot.selectedOrganizationId !== null) {
      return this.resolveSelectedMembership(
        authenticatedIdentity,
        snapshot.selectedOrganizationId,
        snapshot.memberships,
      );
    }

    const authorizedMemberships = snapshot.memberships.filter(
      isAuthorizedMembership,
    );
    if (authorizedMemberships.length === 0) return DENIED_RESOLUTION;
    if (authorizedMemberships.length > 1) {
      return SELECTION_REQUIRED_RESOLUTION;
    }

    const candidate = authorizedMemberships[0];
    if (candidate === undefined) return DENIED_RESOLUTION;

    return Object.freeze({
      status: "auto-selection-required",
      candidate: Object.freeze({
        organizationId: candidate.organizationId,
        membershipId: candidate.membershipId,
      }),
    });
  }

  private resolveSelectedMembership(
    authenticatedIdentity: AuthenticatedIdentity,
    selectedOrganizationId: string,
    memberships: readonly TenantMembershipAuthority[],
  ): TenantAuthorityResolution {
    const selectedMemberships = memberships.filter(
      (membership) => membership.organizationId === selectedOrganizationId,
    );
    if (selectedMemberships.length !== 1) return DENIED_RESOLUTION;

    const selectedMembership = selectedMemberships[0];
    if (
      selectedMembership === undefined ||
      !isAuthorizedMembership(selectedMembership)
    ) {
      return DENIED_RESOLUTION;
    }

    return Object.freeze({
      status: "resolved",
      context: createTenantContext(authenticatedIdentity, selectedMembership),
    });
  }
}
