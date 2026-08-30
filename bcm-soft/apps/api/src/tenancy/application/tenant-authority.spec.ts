import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedIdentity } from "./authenticated-identity.js";
import {
  FailClosedTenantAuthorityResolver,
  type TenantAuthorityResolution,
  type TenantAuthoritySnapshot,
  type TenantAuthoritySnapshotProvider,
  type TenantContext,
  type TenantMembershipAuthority,
} from "./tenant-authority.js";

const USER_ID = "0198d5a0-0000-7000-8000-000000000001";
const OTHER_USER_ID = "0198d5a0-0000-7000-8000-000000000002";
const SESSION_ID = "0198d5a0-0001-7000-8000-000000000001";
const ORGANIZATION_A_ID = "0198d5a0-0002-7000-8000-000000000001";
const ORGANIZATION_B_ID = "0198d5a0-0002-7000-8000-000000000002";
const MEMBERSHIP_A_ID = "0198d5a0-0003-7000-8000-000000000001";
const MEMBERSHIP_B_ID = "0198d5a0-0003-7000-8000-000000000002";

const AUTHENTICATED_IDENTITY: AuthenticatedIdentity = Object.freeze({
  userId: USER_ID,
  sessionId: SESSION_ID,
});

const ACTIVE_MEMBERSHIP_A: TenantMembershipAuthority = Object.freeze({
  membershipId: MEMBERSHIP_A_ID,
  userId: USER_ID,
  organizationId: ORGANIZATION_A_ID,
  membershipStatus: "Active",
  organizationStatus: "Active",
});

const ACTIVE_MEMBERSHIP_B: TenantMembershipAuthority = Object.freeze({
  membershipId: MEMBERSHIP_B_ID,
  userId: USER_ID,
  organizationId: ORGANIZATION_B_ID,
  membershipStatus: "Active",
  organizationStatus: "Active",
});

function availableSnapshot(
  memberships: readonly TenantMembershipAuthority[],
  selectedOrganizationId: string | null = null,
): TenantAuthoritySnapshot {
  return Object.freeze({
    status: "available",
    selectedOrganizationId,
    memberships: Object.freeze([...memberships]),
  });
}

function fixture(snapshot: TenantAuthoritySnapshot) {
  const snapshots: TenantAuthoritySnapshotProvider = {
    loadFor: vi.fn(async () => snapshot),
  };

  return {
    resolver: new FailClosedTenantAuthorityResolver(snapshots),
    snapshots,
  };
}

function resolutionLabel(resolution: TenantAuthorityResolution): string {
  switch (resolution.status) {
    case "resolved":
      return "resolved";
    case "auto-selection-required":
      return "auto-selection-required";
    case "selection-required":
      return "selection-required";
    case "denied":
      return "denied";
    default:
      return assertNever(resolution);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled tenant authority resolution: ${String(value)}`);
}

function tenantContextTypeContract(context: TenantContext): void {
  // @ts-expect-error TenantContext fields are immutable.
  context.organizationId = ORGANIZATION_B_ID;
}
void tenantContextTypeContract;

function tenantContextConstructionContract(): TenantContext {
  // @ts-expect-error TenantContext can only be minted by validated resolution.
  return {
    userId: USER_ID,
    sessionId: SESSION_ID,
    organizationId: ORGANIZATION_A_ID,
    membershipId: MEMBERSHIP_A_ID,
  };
}
void tenantContextConstructionContract;

describe("FailClosedTenantAuthorityResolver", () => {
  it("resolves a selected Active Membership in an Active Organization", async () => {
    const setup = fixture(
      availableSnapshot([ACTIVE_MEMBERSHIP_A], ORGANIZATION_A_ID),
    );

    const resolution = await setup.resolver.resolve(AUTHENTICATED_IDENTITY);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(resolution.context).toMatchObject({
      userId: USER_ID,
      sessionId: SESSION_ID,
      organizationId: ORGANIZATION_A_ID,
      membershipId: MEMBERSHIP_A_ID,
    });
    expect(Object.keys(resolution.context).sort()).toEqual([
      "membershipId",
      "organizationId",
      "sessionId",
      "userId",
    ]);
    expect(Object.isFrozen(resolution.context)).toBe(true);
    expect(resolution.context).not.toHaveProperty("role");
    expect(resolution.context).not.toHaveProperty("permissions");
    expect(resolution.context).not.toHaveProperty("authorizationVersion");
  });

  it("denies when authenticated state is unavailable", async () => {
    const setup = fixture(Object.freeze({ status: "unavailable" }));

    await expect(
      setup.resolver.resolve(AUTHENTICATED_IDENTITY),
    ).resolves.toEqual({ status: "denied" });
    expect(AUTHENTICATED_IDENTITY).not.toHaveProperty("organizationId");
    expect(setup.snapshots.loadFor).toHaveBeenCalledWith(
      AUTHENTICATED_IDENTITY,
    );
  });

  it("denies when no Membership is available", async () => {
    const setup = fixture(availableSnapshot([]));

    await expect(
      setup.resolver.resolve(AUTHENTICATED_IDENTITY),
    ).resolves.toEqual({ status: "denied" });
  });

  it.each(["Suspended", "Revoked"] as const)(
    "denies a %s Membership",
    async (membershipStatus) => {
      const setup = fixture(
        availableSnapshot([{ ...ACTIVE_MEMBERSHIP_A, membershipStatus }]),
      );

      await expect(
        setup.resolver.resolve(AUTHENTICATED_IDENTITY),
      ).resolves.toEqual({ status: "denied" });
    },
  );

  it("denies an Inactive Organization", async () => {
    const setup = fixture(
      availableSnapshot([
        { ...ACTIVE_MEMBERSHIP_A, organizationStatus: "Inactive" },
      ]),
    );

    await expect(
      setup.resolver.resolve(AUTHENTICATED_IDENTITY),
    ).resolves.toEqual({ status: "denied" });
  });

  it("requests atomic auto-selection for exactly one authorized tenant", async () => {
    const setup = fixture(availableSnapshot([ACTIVE_MEMBERSHIP_A]));

    await expect(
      setup.resolver.resolve(AUTHENTICATED_IDENTITY),
    ).resolves.toEqual({
      status: "auto-selection-required",
      candidate: {
        organizationId: ORGANIZATION_A_ID,
        membershipId: MEMBERSHIP_A_ID,
      },
    });
  });

  it("requires explicit selection for multiple authorized tenants", async () => {
    const setup = fixture(
      availableSnapshot([ACTIVE_MEMBERSHIP_A, ACTIVE_MEMBERSHIP_B]),
    );

    await expect(
      setup.resolver.resolve(AUTHENTICATED_IDENTITY),
    ).resolves.toEqual({ status: "selection-required" });
  });

  it.each(["Suspended", "Revoked"] as const)(
    "denies an existing selection whose Membership became %s",
    async (membershipStatus) => {
      const setup = fixture(
        availableSnapshot(
          [{ ...ACTIVE_MEMBERSHIP_A, membershipStatus }],
          ORGANIZATION_A_ID,
        ),
      );

      await expect(
        setup.resolver.resolve(AUTHENTICATED_IDENTITY),
      ).resolves.toEqual({ status: "denied" });
    },
  );

  it("denies an existing selection whose Organization became Inactive", async () => {
    const setup = fixture(
      availableSnapshot(
        [{ ...ACTIVE_MEMBERSHIP_A, organizationStatus: "Inactive" }],
        ORGANIZATION_A_ID,
      ),
    );

    await expect(
      setup.resolver.resolve(AUTHENTICATED_IDENTITY),
    ).resolves.toEqual({ status: "denied" });
  });

  it("does not fall back when the selected tenant is invalid and another is valid", async () => {
    const setup = fixture(
      availableSnapshot(
        [
          { ...ACTIVE_MEMBERSHIP_A, membershipStatus: "Suspended" },
          ACTIVE_MEMBERSHIP_B,
        ],
        ORGANIZATION_A_ID,
      ),
    );

    await expect(
      setup.resolver.resolve(AUTHENTICATED_IDENTITY),
    ).resolves.toEqual({ status: "denied" });
  });

  it("denies a Membership owned by another User", async () => {
    const setup = fixture(
      availableSnapshot([{ ...ACTIVE_MEMBERSHIP_A, userId: OTHER_USER_ID }]),
    );

    await expect(
      setup.resolver.resolve(AUTHENTICATED_IDENTITY),
    ).resolves.toEqual({ status: "denied" });
  });

  it("denies duplicate Membership or Organization authority entries", async () => {
    const duplicateMembership = {
      ...ACTIVE_MEMBERSHIP_B,
      membershipId: MEMBERSHIP_A_ID,
    };
    const duplicateOrganization = {
      ...ACTIVE_MEMBERSHIP_B,
      organizationId: ORGANIZATION_A_ID,
    };

    const resolutions = await Promise.all([
      fixture(
        availableSnapshot([ACTIVE_MEMBERSHIP_A, duplicateMembership]),
      ).resolver.resolve(AUTHENTICATED_IDENTITY),
      fixture(
        availableSnapshot([ACTIVE_MEMBERSHIP_A, duplicateOrganization]),
      ).resolver.resolve(AUTHENTICATED_IDENTITY),
    ]);

    expect(resolutions).toEqual([{ status: "denied" }, { status: "denied" }]);
  });

  it("forces exhaustive handling of every resolution status", async () => {
    const resolutions = await Promise.all([
      fixture(
        availableSnapshot([ACTIVE_MEMBERSHIP_A], ORGANIZATION_A_ID),
      ).resolver.resolve(AUTHENTICATED_IDENTITY),
      fixture(availableSnapshot([ACTIVE_MEMBERSHIP_A])).resolver.resolve(
        AUTHENTICATED_IDENTITY,
      ),
      fixture(
        availableSnapshot([ACTIVE_MEMBERSHIP_A, ACTIVE_MEMBERSHIP_B]),
      ).resolver.resolve(AUTHENTICATED_IDENTITY),
      fixture(availableSnapshot([])).resolver.resolve(AUTHENTICATED_IDENTITY),
    ]);

    expect(resolutions.map(resolutionLabel)).toEqual([
      "resolved",
      "auto-selection-required",
      "selection-required",
      "denied",
    ]);
  });
});
