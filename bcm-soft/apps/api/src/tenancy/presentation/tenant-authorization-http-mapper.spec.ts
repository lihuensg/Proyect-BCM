import { describe, expect, it, vi } from "vitest";

import { SafeHttpException } from "../../observability/safe-http-exception.js";
import type { AuthorizedTenantPersistenceResult } from "../application/tenant-persistence-scope.js";
import {
  InvalidMembershipRoleError,
  InvalidPermissionRequirementError,
  TenantAuthorizationHttpMapper,
} from "./tenant-authorization-http-mapper.js";

function setup() {
  const record = vi.fn();
  return {
    mapper: new TenantAuthorizationHttpMapper({ record }),
    record,
  };
}

function captureFailure<Result>(
  mapper: TenantAuthorizationHttpMapper,
  result: AuthorizedTenantPersistenceResult<Result>,
): unknown {
  try {
    mapper.map(result);
    throw new Error("Expected authorization mapping to fail.");
  } catch (error: unknown) {
    return error;
  }
}

describe("TenantAuthorizationHttpMapper", () => {
  it("returns an executed Application value without additional mapping", () => {
    const { mapper, record } = setup();
    const value = Object.freeze({ status: "found" as const });

    expect(mapper.map({ status: "executed", value })).toBe(value);
    expect(record).not.toHaveBeenCalled();
  });

  it("preserves the existing tenant authority 403", () => {
    const { mapper, record } = setup();
    const error = captureFailure(mapper, { status: "tenant-denied" });

    expect(error).toBeInstanceOf(SafeHttpException);
    if (!(error instanceof SafeHttpException)) return;
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe("TENANT_ACCESS_DENIED");
    expect(error.details).toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it("maps normal permission denial to a generic 403 without details", () => {
    const { mapper, record } = setup();
    const error = captureFailure(mapper, {
      status: "authorization-denied",
      reason: "permission-denied",
    });

    expect(error).toBeInstanceOf(SafeHttpException);
    if (!(error instanceof SafeHttpException)) return;
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe("AUTHORIZATION_DENIED");
    expect(error.details).toBeUndefined();
    expect(error.safeMessage).not.toMatch(/permission|role|version/iu);
    expect(record).toHaveBeenCalledWith("warn", "authorization.denied", {
      module: "tenancy",
      operation: "authorize",
      outcome: "denied",
    });
  });

  it("maps stale authorization to 403 with only its allowlisted signal", () => {
    const { mapper, record } = setup();
    const error = captureFailure(mapper, {
      status: "authorization-denied",
      reason: "stale-authorization",
    });

    expect(error).toBeInstanceOf(SafeHttpException);
    if (!(error instanceof SafeHttpException)) return;
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe("AUTHORIZATION_DENIED");
    expect(error.details).toEqual({ authorizationState: "stale" });
    expect(Object.keys(error.details ?? {})).toEqual(["authorizationState"]);
    expect(record).toHaveBeenCalledWith("warn", "authorization.stale", {
      module: "tenancy",
      operation: "authorize",
      outcome: "denied",
    });
  });

  it("treats an invalid Membership role as an observable server integrity error", () => {
    const { mapper, record } = setup();
    const error = captureFailure(mapper, {
      status: "authorization-denied",
      reason: "invalid-membership-role",
    });

    expect(error).toBeInstanceOf(InvalidMembershipRoleError);
    expect(record).toHaveBeenCalledWith(
      "error",
      "authorization.membership-role.invalid",
      {
        module: "tenancy",
        operation: "authorize",
        outcome: "failure",
      },
    );
    expect(record.mock.calls.flat()).not.toContain("invalid database role");
  });

  it("treats an invalid requirement as an observable server configuration error", () => {
    const { mapper, record } = setup();
    const error = captureFailure(mapper, {
      status: "authorization-denied",
      reason: "invalid-permission-requirement",
    });

    expect(error).toBeInstanceOf(InvalidPermissionRequirementError);
    expect(record).toHaveBeenCalledWith(
      "error",
      "authorization.requirement.invalid",
      {
        module: "tenancy",
        operation: "authorize",
        outcome: "failure",
      },
    );
    expect(record.mock.calls.flat()).not.toContain("unknown.permission");
  });
});
