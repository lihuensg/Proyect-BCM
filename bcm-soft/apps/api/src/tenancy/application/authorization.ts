import type { TenantContext } from "./tenant-authority.js";

export const FOUNDATION_PERMISSIONS = Object.freeze([
  "organization.read",
  "organization.settings.manage",
  "memberships.read",
  "memberships.manage",
  "memberships.manage_owner",
  "invitations.manage",
  "audit.read",
] as const);

export type Permission = (typeof FOUNDATION_PERMISSIONS)[number];

export const MEMBERSHIP_ROLES = Object.freeze([
  "Owner",
  "Admin",
  "Seller",
  "Viewer",
] as const);

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const ADMIN_PERMISSIONS = Object.freeze([
  "organization.read",
  "organization.settings.manage",
  "memberships.read",
  "memberships.manage",
  "invitations.manage",
  "audit.read",
] as const satisfies readonly Permission[]);
const READ_ONLY_PERMISSIONS = Object.freeze([
  "organization.read",
] as const satisfies readonly Permission[]);

export const ROLE_PERMISSIONS = Object.freeze({
  Owner: FOUNDATION_PERMISSIONS,
  Admin: ADMIN_PERMISSIONS,
  Seller: READ_ONLY_PERMISSIONS,
  Viewer: READ_ONLY_PERMISSIONS,
} satisfies Readonly<Record<MembershipRole, readonly Permission[]>>);

const KNOWN_PERMISSIONS: ReadonlySet<unknown> = new Set(FOUNDATION_PERMISSIONS);
const KNOWN_MEMBERSHIP_ROLES: ReadonlySet<unknown> = new Set(MEMBERSHIP_ROLES);

export function isPermission(value: unknown): value is Permission {
  return KNOWN_PERMISSIONS.has(value);
}

export function isMembershipRole(value: unknown): value is MembershipRole {
  return KNOWN_MEMBERSHIP_ROLES.has(value);
}

export function isAuthorizationVersion(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 1n;
}

export type PermissionRequirement<
  RequiredPermission extends Permission = Permission,
> = Readonly<{
  requiredPermission: RequiredPermission;
}>;

export function definePermissionRequirement<
  RequiredPermission extends Permission,
>(
  requiredPermission: RequiredPermission,
): PermissionRequirement<RequiredPermission> {
  if (!isPermission(requiredPermission)) {
    throw new Error("A known Permission is required.");
  }
  return Object.freeze({ requiredPermission });
}

const AUTHORIZATION_CONTEXT_AUTHORITY = Symbol("AuthorizationContextAuthority");

export type AuthorizationContext = Readonly<{
  tenant: TenantContext;
  role: MembershipRole;
  authorizationVersion: bigint;
  permissions: readonly Permission[];
  [AUTHORIZATION_CONTEXT_AUTHORITY]: true;
}>;

export type MembershipAuthorizationSnapshot =
  | Readonly<{ status: "unavailable" }>
  | Readonly<{
      status: "available";
      userId: string;
      sessionId: string;
      organizationId: string;
      membershipId: string;
      role: unknown;
      authorizationVersion: unknown;
    }>;

export interface AuthorizationSnapshotProvider {
  // Implementations must load this snapshot from server-side authority. Client
  // role, permission, tenant, and version claims are never an input here.
  loadFor(
    tenantContext: TenantContext,
  ): Promise<MembershipAuthorizationSnapshot>;
}

export type AuthorizationContextDenialReason =
  | "authority-unavailable"
  | "tenant-mismatch"
  | "unknown-role"
  | "invalid-authorization-version";

export type AuthorizationContextResolution =
  | Readonly<{ status: "resolved"; context: AuthorizationContext }>
  | Readonly<{
      status: "denied";
      reason: AuthorizationContextDenialReason;
    }>;

function deniedContext(
  reason: AuthorizationContextDenialReason,
): AuthorizationContextResolution {
  return Object.freeze({ status: "denied", reason });
}

function matchesTenant(
  snapshot: Extract<MembershipAuthorizationSnapshot, { status: "available" }>,
  tenant: TenantContext,
): boolean {
  return (
    snapshot.userId === tenant.userId &&
    snapshot.sessionId === tenant.sessionId &&
    snapshot.organizationId === tenant.organizationId &&
    snapshot.membershipId === tenant.membershipId
  );
}

function mintAuthorizationContext(
  tenant: TenantContext,
  role: MembershipRole,
  authorizationVersion: bigint,
): AuthorizationContext {
  const context = {
    tenant,
    role,
    authorizationVersion,
    permissions: ROLE_PERMISSIONS[role],
    [AUTHORIZATION_CONTEXT_AUTHORITY]: true as const,
  };

  // The non-enumerable authority marker is intentionally lost by object spread,
  // so copying a context and replacing its tenant never produces authority.
  Object.defineProperty(context, AUTHORIZATION_CONTEXT_AUTHORITY, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return Object.freeze(context);
}

export interface AuthorizationContextResolver {
  resolve(
    tenantContext: TenantContext,
  ): Promise<AuthorizationContextResolution>;
}

export class FailClosedAuthorizationContextResolver implements AuthorizationContextResolver {
  constructor(private readonly snapshots: AuthorizationSnapshotProvider) {}

  async resolve(
    tenantContext: TenantContext,
  ): Promise<AuthorizationContextResolution> {
    const snapshot = await this.snapshots.loadFor(tenantContext);
    if (snapshot.status === "unavailable") {
      return deniedContext("authority-unavailable");
    }
    if (!matchesTenant(snapshot, tenantContext)) {
      return deniedContext("tenant-mismatch");
    }
    if (!isMembershipRole(snapshot.role)) {
      return deniedContext("unknown-role");
    }
    if (!isAuthorizationVersion(snapshot.authorizationVersion)) {
      return deniedContext("invalid-authorization-version");
    }

    return Object.freeze({
      status: "resolved",
      context: mintAuthorizationContext(
        tenantContext,
        snapshot.role,
        snapshot.authorizationVersion,
      ),
    });
  }
}

export type AuthorizationDenialReason =
  "invalid-context" | "unknown-permission" | "permission-not-granted";

export type AuthorizationDecision =
  | Readonly<{ status: "allowed" }>
  | Readonly<{ status: "denied"; reason: AuthorizationDenialReason }>;

const ALLOWED: AuthorizationDecision = Object.freeze({ status: "allowed" });

function denied(reason: AuthorizationDenialReason): AuthorizationDecision {
  return Object.freeze({ status: "denied", reason });
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isIssuedAuthorizationContext(
  value: unknown,
): value is AuthorizationContext {
  if (!isObject(value)) return false;
  if (value[AUTHORIZATION_CONTEXT_AUTHORITY] !== true) return false;
  if (!Object.isFrozen(value)) return false;
  if (!isMembershipRole(value.role)) return false;
  if (!isAuthorizationVersion(value.authorizationVersion)) return false;

  return value.permissions === ROLE_PERMISSIONS[value.role];
}

export class AuthorizationPolicy {
  authorize(
    authorizationContext: unknown,
    requiredPermission: unknown,
  ): AuthorizationDecision {
    if (!isPermission(requiredPermission)) {
      return denied("unknown-permission");
    }
    if (!isIssuedAuthorizationContext(authorizationContext)) {
      return denied("invalid-context");
    }

    return authorizationContext.permissions.includes(requiredPermission)
      ? ALLOWED
      : denied("permission-not-granted");
  }

  can(authorizationContext: unknown, requiredPermission: unknown): boolean {
    return (
      this.authorize(authorizationContext, requiredPermission).status ===
      "allowed"
    );
  }
}

const ADMIN_TARGET_ROLES = Object.freeze([
  "Seller",
  "Viewer",
] as const satisfies readonly MembershipRole[]);
const NO_TARGET_ROLES = Object.freeze(
  [] as const satisfies readonly MembershipRole[],
);

const TARGET_ROLES_BY_ACTOR = Object.freeze({
  Owner: MEMBERSHIP_ROLES,
  Admin: ADMIN_TARGET_ROLES,
  Seller: NO_TARGET_ROLES,
  Viewer: NO_TARGET_ROLES,
} satisfies Readonly<Record<MembershipRole, readonly MembershipRole[]>>);

export type RoleTargetEligibilityDecision =
  | Readonly<{ status: "eligible" }>
  | Readonly<{
      status: "denied";
      reason: "unknown-role" | "target-role-denied";
    }>;

const ELIGIBLE: RoleTargetEligibilityDecision = Object.freeze({
  status: "eligible",
});

function deniedTarget(
  reason: "unknown-role" | "target-role-denied",
): RoleTargetEligibilityDecision {
  return Object.freeze({ status: "denied", reason });
}

/**
 * Evaluates only approved actor-role to target-role eligibility. An eligible
 * result is not complete mutation authorization: the use case must separately
 * enforce its PermissionRequirement plus self-escalation, target identity and
 * lifecycle rules, and the last-active-Owner invariant when applicable.
 */
export class RoleTargetEligibilityPolicy {
  evaluateMembershipManagement(
    actorRole: unknown,
    targetRole: unknown,
  ): RoleTargetEligibilityDecision {
    return this.evaluate(actorRole, targetRole);
  }

  evaluateInvitation(
    actorRole: unknown,
    targetRole: unknown,
  ): RoleTargetEligibilityDecision {
    return this.evaluate(actorRole, targetRole);
  }

  private evaluate(
    actorRole: unknown,
    targetRole: unknown,
  ): RoleTargetEligibilityDecision {
    if (!isMembershipRole(actorRole) || !isMembershipRole(targetRole)) {
      return deniedTarget("unknown-role");
    }

    return TARGET_ROLES_BY_ACTOR[actorRole].some(
      (allowedTargetRole) => allowedTargetRole === targetRole,
    )
      ? ELIGIBLE
      : deniedTarget("target-role-denied");
  }
}
