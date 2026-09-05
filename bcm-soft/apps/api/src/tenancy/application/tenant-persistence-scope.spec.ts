import { describe, expect, expectTypeOf, it } from "vitest";

import type { PermissionRequirement } from "./authorization.js";
import type { TenantContext } from "./tenant-authority.js";
import {
  type AuthorizedTenantOperation,
  type AuthorizedTenantPersistenceResult,
  TenantRepositoryScopeClosedError,
  TenantRepositoryScopeLease,
  type TenantFoundationPersistenceScope,
  type TenantPersistenceResult,
  type TenantPersistenceScope,
} from "./tenant-persistence-scope.js";

type ProbeRepositories = Readonly<{
  read(resourceId: string): Promise<string | undefined>;
}>;

function resultLabel(result: TenantPersistenceResult<string>): string {
  switch (result.status) {
    case "executed":
      return result.value;
    case "denied":
      return "denied";
  }
}

function authorizedResultLabel(
  result: AuthorizedTenantPersistenceResult<string>,
): string {
  switch (result.status) {
    case "executed":
      return result.value;
    case "tenant-denied":
      return "tenant-denied";
    case "authorization-denied":
      return result.reason;
  }
}

describe("TenantPersistenceScope application contract", () => {
  it("keeps Prisma and organization overrides out of the repository surface", () => {
    expectTypeOf<Parameters<ProbeRepositories["read"]>>().toEqualTypeOf<
      [resourceId: string]
    >();
    expectTypeOf<
      TenantFoundationPersistenceScope<ProbeRepositories>["run"]
    >().toBeFunction();
    expectTypeOf<
      Parameters<TenantFoundationPersistenceScope<ProbeRepositories>["run"]>[0]
    >().toEqualTypeOf<TenantContext>();
    expectTypeOf<
      TenantPersistenceScope<ProbeRepositories>["runAuthorized"]
    >().toBeFunction();
    expectTypeOf<
      Parameters<TenantPersistenceScope<ProbeRepositories>["runAuthorized"]>[1]
    >().toEqualTypeOf<PermissionRequirement>();
    expectTypeOf<
      Parameters<TenantPersistenceScope<ProbeRepositories>["runAuthorized"]>[2]
    >().toEqualTypeOf<
      (scope: AuthorizedTenantOperation<ProbeRepositories>) => Promise<unknown>
    >();
  });

  it("distinguishes tenant, stale, role, requirement, and permission denial", () => {
    const results: readonly AuthorizedTenantPersistenceResult<string>[] = [
      Object.freeze({ status: "executed", value: "value" }),
      Object.freeze({ status: "tenant-denied" }),
      Object.freeze({
        status: "authorization-denied",
        reason: "stale-authorization",
      }),
      Object.freeze({
        status: "authorization-denied",
        reason: "invalid-membership-role",
      }),
      Object.freeze({
        status: "authorization-denied",
        reason: "invalid-permission-requirement",
      }),
      Object.freeze({
        status: "authorization-denied",
        reason: "permission-denied",
      }),
    ];

    expect(results.map(authorizedResultLabel)).toEqual([
      "value",
      "tenant-denied",
      "stale-authorization",
      "invalid-membership-role",
      "invalid-permission-requirement",
      "permission-denied",
    ]);
  });

  it("models executed and denied results exhaustively", () => {
    const results: readonly TenantPersistenceResult<string>[] = [
      Object.freeze({ status: "executed", value: "value" }),
      Object.freeze({ status: "denied" }),
    ];

    expect(results.map(resultLabel)).toEqual(["value", "denied"]);
  });

  it("invalidates tenant-bound repositories when their scope closes", async () => {
    const lease = new TenantRepositoryScopeLease();
    const repository: ProbeRepositories = {
      read: async () => {
        lease.assertActive();
        return "value";
      },
    };

    await expect(repository.read("resource-id")).resolves.toBe("value");
    lease.close();
    await expect(repository.read("resource-id")).rejects.toBeInstanceOf(
      TenantRepositoryScopeClosedError,
    );
  });
});
