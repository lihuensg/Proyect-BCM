import type { TenantContext } from "./tenant-authority.js";

export type TenantPersistenceResult<Result> =
  | Readonly<{ status: "executed"; value: Result }>
  | Readonly<{ status: "denied" }>;

export interface TenantPersistenceScope<Repositories> {
  run<Result>(
    tenantContext: TenantContext,
    operation: (repositories: Repositories) => Promise<Result>,
  ): Promise<TenantPersistenceResult<Result>>;
}

export class TenantPersistenceError extends Error {
  constructor(cause: unknown) {
    super("Tenant persistence failed.", { cause });
    this.name = "TenantPersistenceError";
  }
}

export class TenantRepositoryScopeClosedError extends Error {
  constructor() {
    super("The tenant repository scope is closed.");
    this.name = "TenantRepositoryScopeClosedError";
  }
}

// Infrastructure gives this lease only to tenant-bound repository adapters.
// Application callbacks receive repositories, never the lease or its lifecycle control.
export class TenantRepositoryScopeLease {
  #active = true;

  assertActive(): void {
    if (!this.#active) {
      throw new TenantRepositoryScopeClosedError();
    }
  }

  close(): void {
    this.#active = false;
  }
}
