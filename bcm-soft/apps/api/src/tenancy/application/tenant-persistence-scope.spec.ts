import { describe, expect, expectTypeOf, it } from "vitest";

import type { TenantContext } from "./tenant-authority.js";
import {
  TenantRepositoryScopeClosedError,
  TenantRepositoryScopeLease,
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

describe("TenantPersistenceScope application contract", () => {
  it("keeps Prisma and organization overrides out of the repository surface", () => {
    expectTypeOf<Parameters<ProbeRepositories["read"]>>().toEqualTypeOf<
      [resourceId: string]
    >();
    expectTypeOf<
      TenantPersistenceScope<ProbeRepositories>["run"]
    >().toBeFunction();
    expectTypeOf<
      Parameters<TenantPersistenceScope<ProbeRepositories>["run"]>[0]
    >().toEqualTypeOf<TenantContext>();
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
