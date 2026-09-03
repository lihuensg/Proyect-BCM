import { describe, expect, it } from "vitest";

import type { AuthenticatedIdentity } from "./authenticated-identity.js";
import {
  AuthorizationPolicy,
  definePermissionRequirement,
  FailClosedAuthorizationContextResolver,
  FOUNDATION_PERMISSIONS,
  isAuthorizationVersion,
  isMembershipRole,
  isPermission,
  MEMBERSHIP_ROLES,
  type AuthorizationContext,
  type AuthorizationContextResolution,
  type AuthorizationSnapshotProvider,
  type MembershipAuthorizationSnapshot,
  type PermissionRequirement,
  ROLE_PERMISSIONS,
  RoleTargetEligibilityPolicy,
} from "./authorization.js";
import {
  FailClosedTenantAuthorityResolver,
  type TenantAuthoritySnapshotProvider,
  type TenantContext,
} from "./tenant-authority.js";

const USER_ID = "0198d5a0-0000-7000-8000-000000000001";
const SESSION_ID = "0198d5a0-0001-7000-8000-000000000001";
const ORGANIZATION_A_ID = "0198d5a0-0002-7000-8000-000000000001";
const ORGANIZATION_B_ID = "0198d5a0-0002-7000-8000-000000000002";
const MEMBERSHIP_A_ID = "0198d5a0-0003-7000-8000-000000000001";
const MEMBERSHIP_B_ID = "0198d5a0-0003-7000-8000-000000000002";

async function tenantContext(
  organizationId = ORGANIZATION_A_ID,
  membershipId = MEMBERSHIP_A_ID,
): Promise<TenantContext> {
  const identity: AuthenticatedIdentity = Object.freeze({
    userId: USER_ID,
    sessionId: SESSION_ID,
  });
  const snapshots: TenantAuthoritySnapshotProvider = {
    loadFor: () =>
      Promise.resolve(
        Object.freeze({
          status: "available" as const,
          selectedOrganizationId: organizationId,
          memberships: Object.freeze([
            Object.freeze({
              membershipId,
              userId: USER_ID,
              organizationId,
              membershipStatus: "Active" as const,
              organizationStatus: "Active" as const,
            }),
          ]),
        }),
      ),
  };
  const resolution = await new FailClosedTenantAuthorityResolver(
    snapshots,
  ).resolve(identity);

  if (resolution.status !== "resolved") {
    throw new Error("The test TenantContext could not be resolved.");
  }
  return resolution.context;
}

function availableAuthorizationSnapshot(
  tenant: TenantContext,
  role: unknown,
  authorizationVersion: unknown,
): MembershipAuthorizationSnapshot {
  return Object.freeze({
    status: "available",
    userId: tenant.userId,
    sessionId: tenant.sessionId,
    organizationId: tenant.organizationId,
    membershipId: tenant.membershipId,
    role,
    authorizationVersion,
  });
}

function authorizationFixture(snapshot: MembershipAuthorizationSnapshot) {
  const snapshots: AuthorizationSnapshotProvider = {
    loadFor: () => Promise.resolve(snapshot),
  };

  return new FailClosedAuthorizationContextResolver(snapshots);
}

async function resolvedAuthorizationContext(
  role: "Owner" | "Admin" | "Seller" | "Viewer" = "Owner",
  tenant?: TenantContext,
  authorizationVersion = 1n,
): Promise<AuthorizationContext> {
  const resolvedTenant = tenant ?? (await tenantContext());
  const resolution = await authorizationFixture(
    availableAuthorizationSnapshot(resolvedTenant, role, authorizationVersion),
  ).resolve(resolvedTenant);
  if (resolution.status !== "resolved") {
    throw new Error("The test AuthorizationContext could not be resolved.");
  }
  return resolution.context;
}

function authorizationContextTypeContract(context: AuthorizationContext): void {
  // @ts-expect-error AuthorizationContext fields are immutable.
  context.role = "Owner";
  // @ts-expect-error AuthorizationContext permissions are immutable.
  context.permissions.push("memberships.manage_owner");
}
void authorizationContextTypeContract;

function authorizationContextConstructionContract(
  tenant: TenantContext,
): AuthorizationContext {
  // @ts-expect-error AuthorizationContext can only be minted by its resolver.
  return {
    tenant,
    role: "Owner",
    authorizationVersion: 1n,
    permissions: ROLE_PERMISSIONS.Owner,
  };
}
void authorizationContextConstructionContract;

function permissionInjectionTypeContract(
  tenant: TenantContext,
): MembershipAuthorizationSnapshot {
  return {
    status: "available",
    userId: tenant.userId,
    sessionId: tenant.sessionId,
    organizationId: tenant.organizationId,
    membershipId: tenant.membershipId,
    role: "Viewer",
    authorizationVersion: 1n,
    // @ts-expect-error A server snapshot cannot provide arbitrary permissions.
    permissions: ["memberships.manage_owner"],
  };
}
void permissionInjectionTypeContract;

function rolePermissionMappingTypeContract(): void {
  // @ts-expect-error Role permission arrays are immutable.
  ROLE_PERMISSIONS.Admin.push("memberships.manage_owner");
  // @ts-expect-error Role mappings cannot be replaced.
  ROLE_PERMISSIONS.Owner = ROLE_PERMISSIONS.Viewer;
}
void rolePermissionMappingTypeContract;

describe("foundation permission catalog", () => {
  it("contains exactly the seven approved permissions", () => {
    expect(FOUNDATION_PERMISSIONS).toEqual([
      "organization.read",
      "organization.settings.manage",
      "memberships.read",
      "memberships.manage",
      "memberships.manage_owner",
      "invitations.manage",
      "audit.read",
    ]);
  });

  it("contains no duplicates", () => {
    expect(new Set(FOUNDATION_PERMISSIONS).size).toBe(
      FOUNDATION_PERMISSIONS.length,
    );
  });

  it("contains no wildcard permission", () => {
    expect(
      FOUNDATION_PERMISSIONS.some((permission) => permission.includes("*")),
    ).toBe(false);
  });

  it("recognizes only catalog permissions", () => {
    expect(isPermission("audit.read")).toBe(true);
    expect(isPermission("audit.write")).toBe(false);
    expect(isPermission("*")).toBe(false);
  });
});

describe("membership role mapping", () => {
  it("maps Owner to exactly all seven foundation permissions", () => {
    expect(ROLE_PERMISSIONS.Owner).toEqual(FOUNDATION_PERMISSIONS);
  });

  it("maps Admin to exactly six permissions without owner management", () => {
    expect(ROLE_PERMISSIONS.Admin).toEqual([
      "organization.read",
      "organization.settings.manage",
      "memberships.read",
      "memberships.manage",
      "invitations.manage",
      "audit.read",
    ]);
    expect(ROLE_PERMISSIONS.Admin).not.toContain("memberships.manage_owner");
  });

  it.each(["Seller", "Viewer"] as const)(
    "maps %s to only organization.read",
    (role) => {
      expect(ROLE_PERMISSIONS[role]).toEqual(["organization.read"]);
    },
  );

  it("is exhaustive for exactly the four approved roles", () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toEqual(MEMBERSHIP_ROLES);
  });

  it("is deeply immutable at runtime", () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    for (const role of MEMBERSHIP_ROLES) {
      expect(Object.isFrozen(ROLE_PERMISSIONS[role])).toBe(true);
    }
    expect(() =>
      Reflect.apply(Array.prototype.push, ROLE_PERMISSIONS.Admin, [
        "memberships.manage_owner",
      ]),
    ).toThrow(TypeError);
    expect(
      Reflect.set(ROLE_PERMISSIONS.Admin, 0, "memberships.manage_owner"),
    ).toBe(false);
    expect(
      Reflect.set(ROLE_PERMISSIONS, "Owner", ROLE_PERMISSIONS.Viewer),
    ).toBe(false);
    expect(ROLE_PERMISSIONS.Owner).toBe(FOUNDATION_PERMISSIONS);
    expect(ROLE_PERMISSIONS.Admin).not.toContain("memberships.manage_owner");
  });

  it("recognizes no unknown role or implicit hierarchy", () => {
    expect(isMembershipRole("Owner")).toBe(true);
    expect(isMembershipRole("SuperAdmin")).toBe(false);
    expect(isMembershipRole(4)).toBe(false);
  });
});

describe("AuthorizationContext resolution", () => {
  it("derives permissions only from the central role mapping", async () => {
    const context = await resolvedAuthorizationContext("Admin");

    expect(context.permissions).toBe(ROLE_PERMISSIONS.Admin);
  });

  it("ignores an extra runtime permissions claim instead of injecting it", async () => {
    const tenant = await tenantContext();
    const snapshotWithUntrustedPermissions = Object.freeze({
      ...availableAuthorizationSnapshot(tenant, "Viewer", 1n),
      permissions: Object.freeze(["memberships.manage_owner"]),
    });

    const resolution = await authorizationFixture(
      snapshotWithUntrustedPermissions,
    ).resolve(tenant);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(resolution.context.permissions).toEqual(["organization.read"]);
    expect(resolution.context.permissions).toBe(ROLE_PERMISSIONS.Viewer);
  });

  it("returns a readonly and frozen server-created context", async () => {
    const context = await resolvedAuthorizationContext();

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.permissions)).toBe(true);
    expect(Reflect.set(context, "role", "Viewer")).toBe(false);
    expect(context.role).toBe("Owner");
  });

  it("uses a non-enumerable, non-writable, non-configurable authority brand", async () => {
    const context = await resolvedAuthorizationContext();
    const symbols = Object.getOwnPropertySymbols(context);
    const authoritySymbol = symbols[0];
    if (authoritySymbol === undefined) {
      throw new Error("The AuthorizationContext authority brand is missing.");
    }

    expect(symbols).toHaveLength(1);
    expect(Object.getOwnPropertyDescriptor(context, authoritySymbol)).toEqual({
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
    expect(Object.keys(context).sort()).toEqual([
      "authorizationVersion",
      "permissions",
      "role",
      "tenant",
    ]);
  });

  it("leaves TenantContext unchanged and separate", async () => {
    const tenant = await tenantContext();
    const before = Object.keys(tenant).sort();

    const context = await resolvedAuthorizationContext("Owner", tenant);

    expect(context.tenant).toBe(tenant);
    expect(Object.keys(tenant).sort()).toEqual(before);
    expect(tenant).not.toHaveProperty("role");
    expect(tenant).not.toHaveProperty("permissions");
    expect(tenant).not.toHaveProperty("authorizationVersion");
  });

  it("preserves authorizationVersion as a precision-safe bigint", async () => {
    const version = 9_007_199_254_740_993n;
    const context = await resolvedAuthorizationContext(
      "Owner",
      await tenantContext(),
      version,
    );

    expect(context.authorizationVersion).toBe(version);
    expect(typeof context.authorizationVersion).toBe("bigint");
    expect(isAuthorizationVersion(version)).toBe(true);
  });

  it.each([
    0n,
    -1n,
    1,
    "1",
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("denies invalid authorizationVersion %s", async (authorizationVersion) => {
    const tenant = await tenantContext();

    await expect(
      authorizationFixture(
        availableAuthorizationSnapshot(tenant, "Owner", authorizationVersion),
      ).resolve(tenant),
    ).resolves.toEqual({
      status: "denied",
      reason: "invalid-authorization-version",
    });
  });

  it("denies an unknown runtime role without a fallback", async () => {
    const tenant = await tenantContext();

    await expect(
      authorizationFixture(
        availableAuthorizationSnapshot(tenant, "SuperAdmin", 1n),
      ).resolve(tenant),
    ).resolves.toEqual({ status: "denied", reason: "unknown-role" });
  });

  it("denies unavailable authority", async () => {
    const tenant = await tenantContext();

    await expect(
      authorizationFixture(Object.freeze({ status: "unavailable" })).resolve(
        tenant,
      ),
    ).resolves.toEqual({
      status: "denied",
      reason: "authority-unavailable",
    });
  });

  it("denies a server snapshot bound to a different organization", async () => {
    const tenantA = await tenantContext();
    const tenantB = await tenantContext(ORGANIZATION_B_ID, MEMBERSHIP_B_ID);

    await expect(
      authorizationFixture(
        availableAuthorizationSnapshot(tenantA, "Owner", 1n),
      ).resolve(tenantB),
    ).resolves.toEqual({ status: "denied", reason: "tenant-mismatch" });
  });

  it("does not let object spread move organization authority to tenant B", async () => {
    const contextA = await resolvedAuthorizationContext(
      "Owner",
      await tenantContext(),
    );
    const tenantB = await tenantContext(ORGANIZATION_B_ID, MEMBERSHIP_B_ID);
    const forgedForTenantB = { ...contextA, tenant: tenantB };
    const policy = new AuthorizationPolicy();

    expect(
      policy.authorize(forgedForTenantB, "memberships.manage_owner"),
    ).toEqual({ status: "denied", reason: "invalid-context" });
  });
});

describe("AuthorizationPolicy", () => {
  it.each(FOUNDATION_PERMISSIONS)(
    "allows Owner permission %s",
    async (permission) => {
      const context = await resolvedAuthorizationContext("Owner");

      expect(new AuthorizationPolicy().authorize(context, permission)).toEqual({
        status: "allowed",
      });
    },
  );

  it("denies memberships.manage_owner to Admin", async () => {
    const context = await resolvedAuthorizationContext("Admin");

    expect(
      new AuthorizationPolicy().authorize(context, "memberships.manage_owner"),
    ).toEqual({ status: "denied", reason: "permission-not-granted" });
  });

  it("denies memberships.manage to Seller", async () => {
    const context = await resolvedAuthorizationContext("Seller");

    expect(
      new AuthorizationPolicy().authorize(context, "memberships.manage"),
    ).toEqual({ status: "denied", reason: "permission-not-granted" });
  });

  it("denies organization.settings.manage to Viewer", async () => {
    const context = await resolvedAuthorizationContext("Viewer");

    expect(
      new AuthorizationPolicy().authorize(
        context,
        "organization.settings.manage",
      ),
    ).toEqual({ status: "denied", reason: "permission-not-granted" });
  });

  it("denies every catalog permission absent from a role mapping", async () => {
    const context = await resolvedAuthorizationContext("Viewer");
    const policy = new AuthorizationPolicy();

    for (const permission of FOUNDATION_PERMISSIONS) {
      expect(policy.can(context, permission)).toBe(
        permission === "organization.read",
      );
    }
  });

  it("denies an unknown runtime permission", async () => {
    const context = await resolvedAuthorizationContext("Owner");

    expect(new AuthorizationPolicy().authorize(context, "*")).toEqual({
      status: "denied",
      reason: "unknown-permission",
    });
  });

  it("denies an incomplete or unissued context", () => {
    expect(
      new AuthorizationPolicy().authorize(
        Object.freeze({ role: "Owner" }),
        "organization.read",
      ),
    ).toEqual({ status: "denied", reason: "invalid-context" });
  });

  it("defines a typed immutable use-case permission requirement", () => {
    const requirement: PermissionRequirement<"memberships.read"> =
      definePermissionRequirement("memberships.read");

    expect(requirement).toEqual({ requiredPermission: "memberships.read" });
    expect(Object.isFrozen(requirement)).toBe(true);
  });

  it("rejects an unknown runtime permission requirement", () => {
    expect(() =>
      Reflect.apply(definePermissionRequirement, undefined, ["*"]),
    ).toThrow("A known Permission is required.");
  });
});

describe("RoleTargetEligibilityPolicy", () => {
  const policy = new RoleTargetEligibilityPolicy();

  it("allows Owner to target Owner at the role-target layer", () => {
    expect(policy.evaluateMembershipManagement("Owner", "Owner")).toEqual({
      status: "eligible",
    });
  });

  it.each(["Owner", "Admin"] as const)(
    "denies Admin targeting %s",
    (targetRole) => {
      expect(policy.evaluateMembershipManagement("Admin", targetRole)).toEqual({
        status: "denied",
        reason: "target-role-denied",
      });
    },
  );

  it.each(["Seller", "Viewer"] as const)(
    "allows Admin targeting %s",
    (targetRole) => {
      expect(policy.evaluateMembershipManagement("Admin", targetRole)).toEqual({
        status: "eligible",
      });
    },
  );

  it.each(["Seller", "Viewer"] as const)(
    "lets no target role be managed by %s",
    (actorRole) => {
      for (const targetRole of MEMBERSHIP_ROLES) {
        expect(
          policy.evaluateMembershipManagement(actorRole, targetRole),
        ).toEqual({ status: "denied", reason: "target-role-denied" });
      }
    },
  );

  it("reuses the approved target-role matrix for invitations", () => {
    expect(policy.evaluateInvitation("Owner", "Admin")).toEqual({
      status: "eligible",
    });
    expect(policy.evaluateInvitation("Admin", "Seller")).toEqual({
      status: "eligible",
    });
    expect(policy.evaluateInvitation("Admin", "Owner")).toEqual({
      status: "denied",
      reason: "target-role-denied",
    });
  });

  it.each(MEMBERSHIP_ROLES)(
    "allows Owner to invite %s at the role-target layer",
    (targetRole) => {
      expect(policy.evaluateInvitation("Owner", targetRole)).toEqual({
        status: "eligible",
      });
    },
  );

  it.each(["Seller", "Viewer"] as const)(
    "lets no target role be invited by %s",
    (actorRole) => {
      for (const targetRole of MEMBERSHIP_ROLES) {
        expect(policy.evaluateInvitation(actorRole, targetRole)).toEqual({
          status: "denied",
          reason: "target-role-denied",
        });
      }
    },
  );

  it("denies unknown actor and target roles", () => {
    expect(policy.evaluateMembershipManagement("SuperAdmin", "Viewer")).toEqual(
      { status: "denied", reason: "unknown-role" },
    );
    expect(policy.evaluateInvitation("Owner", "Guest")).toEqual({
      status: "denied",
      reason: "unknown-role",
    });
  });
});

function resolutionStatus(resolution: AuthorizationContextResolution): string {
  switch (resolution.status) {
    case "resolved":
      return "resolved";
    case "denied":
      return "denied";
  }
}
void resolutionStatus;
