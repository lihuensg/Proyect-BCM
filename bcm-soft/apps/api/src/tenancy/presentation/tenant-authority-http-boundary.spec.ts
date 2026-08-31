import { describe, expect, it, vi } from "vitest";

import type { SessionService } from "../../identity/application/session-service.js";
import type { SessionCookieCodec } from "../../identity/presentation/session-cookie-codec.js";
import { SafeHttpException } from "../../observability/safe-http-exception.js";
import {
  FailClosedTenantAuthorityResolver,
  type TenantAuthorityResolution,
  type TenantAuthorityResolver,
  type TenantContext,
} from "../application/tenant-authority.js";
import { TenantAuthorityHttpBoundary } from "./tenant-authority-http-boundary.js";
import {
  attachTenantContext,
  hasTenantContext,
  requireTenantContext,
  type TenantContextRequest,
} from "./tenant-request-context.js";

const USER_ID = "0198d5a0-0000-7000-8000-000000000001";
const SESSION_ID = "0198d5a0-0001-7000-8000-000000000001";
const ORGANIZATION_ID = "0198d5a0-0002-7000-8000-000000000001";
const MEMBERSHIP_ID = "0198d5a0-0003-7000-8000-000000000001";
const RAW_TOKEN = "opaque-session-token";

async function mintTenantContext(): Promise<TenantContext> {
  const resolver = new FailClosedTenantAuthorityResolver({
    loadFor: async () => ({
      status: "available",
      selectedOrganizationId: ORGANIZATION_ID,
      memberships: [
        {
          membershipId: MEMBERSHIP_ID,
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          membershipStatus: "Active",
          organizationStatus: "Active",
        },
      ],
    }),
  });
  const resolution = await resolver.resolve({
    userId: USER_ID,
    sessionId: SESSION_ID,
  });
  if (resolution.status !== "resolved") {
    throw new Error("The test TenantContext could not be minted.");
  }
  return resolution.context;
}

function createBoundary(
  resolution: TenantAuthorityResolution,
  sessionStatus: "valid" | "invalid" = "valid",
) {
  const cookies: Pick<SessionCookieCodec, "parse"> = {
    parse: vi.fn(() => RAW_TOKEN),
  };
  const sessions: Pick<SessionService, "validateSession"> = {
    validateSession: vi.fn(async () =>
      sessionStatus === "invalid"
        ? { status: "invalid" as const }
        : {
            status: "valid" as const,
            sessionId: SESSION_ID,
            userId: USER_ID,
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            selectedOrganizationId: ORGANIZATION_ID,
            selectedMembershipAuthorizationVersion: 1n,
          },
    ),
  };
  const authority: TenantAuthorityResolver = {
    resolve: vi.fn(async () => resolution),
  };

  return {
    authority,
    boundary: new TenantAuthorityHttpBoundary(cookies, sessions, authority),
    cookies,
    sessions,
  };
}

async function expectSafeError(
  operation: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected the operation to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SafeHttpException);
    if (!(error instanceof SafeHttpException)) return;
    expect(error.getStatus()).toBe(status);
    expect(error.code).toBe(code);
  }
}

describe("TenantAuthorityHttpBoundary", () => {
  it("derives AuthenticatedIdentity only from a validated backend Session", async () => {
    const context = await mintTenantContext();
    const setup = createBoundary({ status: "resolved", context });

    await expect(setup.boundary.resolve("cookie-header")).resolves.toBe(
      context,
    );
    expect(setup.cookies.parse).toHaveBeenCalledWith("cookie-header");
    expect(setup.sessions.validateSession).toHaveBeenCalledWith(RAW_TOKEN);
    expect(setup.authority.resolve).toHaveBeenCalledWith({
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
  });

  it("maps a missing or invalid Session to 401 without resolving tenant authority", async () => {
    const denied: TenantAuthorityResolution = { status: "denied" };
    const missing = createBoundary(denied);
    missing.cookies.parse = vi.fn(() => null);
    const missingBoundary = new TenantAuthorityHttpBoundary(
      missing.cookies,
      missing.sessions,
      missing.authority,
    );
    const invalid = createBoundary(denied, "invalid");

    await expectSafeError(
      missingBoundary.resolve(undefined),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    await expectSafeError(
      invalid.boundary.resolve("cookie-header"),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    expect(missing.sessions.validateSession).not.toHaveBeenCalled();
    expect(missing.authority.resolve).not.toHaveBeenCalled();
    expect(invalid.authority.resolve).not.toHaveBeenCalled();
  });

  it.each(["denied", "auto-selection-required"] as const)(
    "maps %s to tenant 403 without changing Authentication semantics",
    async (status) => {
      const resolution: TenantAuthorityResolution =
        status === "denied"
          ? { status }
          : {
              status,
              candidate: {
                organizationId: ORGANIZATION_ID,
                membershipId: MEMBERSHIP_ID,
              },
            };
      const setup = createBoundary(resolution);

      await expectSafeError(
        setup.boundary.resolve("cookie-header"),
        403,
        "TENANT_ACCESS_DENIED",
      );
    },
  );

  it("maps explicit selection-required to 409", async () => {
    const setup = createBoundary({ status: "selection-required" });

    await expectSafeError(
      setup.boundary.resolve("cookie-header"),
      409,
      "TENANT_SELECTION_REQUIRED",
    );
  });

  it("does not translate an authority infrastructure failure into 403", async () => {
    const failure = new Error("synthetic authority failure");
    const setup = createBoundary({ status: "denied" });
    setup.authority.resolve = vi.fn(async () => Promise.reject(failure));
    const boundary = new TenantAuthorityHttpBoundary(
      setup.cookies,
      setup.sessions,
      setup.authority,
    );

    await expect(boundary.resolve("cookie-header")).rejects.toBe(failure);
  });
});

describe("Tenant request context", () => {
  it("attaches the exact resolved context as non-enumerable immutable metadata", async () => {
    const context = await mintTenantContext();
    const request: TenantContextRequest & Record<string, unknown> = {
      organizationId: "attacker-supplied-organization",
      tenantContext: {
        organizationId: "attacker-supplied-organization",
      },
    };

    expect(hasTenantContext(request)).toBe(false);
    expect(() => requireTenantContext(request)).toThrow(
      "TenantContext is unavailable on this request.",
    );

    attachTenantContext(request, context);

    expect(Object.getOwnPropertySymbols(request)).toHaveLength(1);
    expect(hasTenantContext(request)).toBe(true);
    expect(requireTenantContext(request)).toBe(context);
    expect(Object.keys(request)).toEqual(["organizationId", "tenantContext"]);
    expect(
      Object.getOwnPropertyDescriptor(
        request,
        Object.getOwnPropertySymbols(request)[0] ?? Symbol(),
      )?.value,
    ).toBe(context);
    expect(() => attachTenantContext(request, context)).toThrow(
      "TenantContext is already attached to this request.",
    );
  });
});
