import type { TenantContext } from "./tenant-authority.js";
import type {
  AuthorizationContext,
  PermissionRequirement,
} from "./authorization.js";

export type TenantPersistenceResult<Result> =
  | Readonly<{ status: "executed"; value: Result }>
  | Readonly<{ status: "denied" }>;

export type AuthorizationPersistenceDenialReason =
  | "stale-authorization"
  | "invalid-membership-role"
  | "invalid-permission-requirement"
  | "permission-denied";

export type AuthorizedTenantPersistenceResult<Result> =
  | Readonly<{ status: "executed"; value: Result }>
  | Readonly<{ status: "tenant-denied" }>
  | Readonly<{
      status: "authorization-denied";
      reason: AuthorizationPersistenceDenialReason;
    }>;

export type AuthorizedTenantOperation<Repositories> = Readonly<{
  // This context is a transaction snapshot for decisions inside the callback.
  // Returning it never replaces re-entry through runAuthorized for later work.
  authorization: AuthorizationContext;
  repositories: Repositories;
}>;

// This narrow contract exists only for TEN-001 foundation plumbing and its
// boundary tests. Product modules must depend on TenantPersistenceScope.
export interface TenantFoundationPersistenceScope<Repositories> {
  run<Result>(
    tenantContext: TenantContext,
    operation: (repositories: Repositories) => Promise<Result>,
  ): Promise<TenantPersistenceResult<Result>>;
}

export interface TenantPersistenceScope<Repositories> {
  runAuthorized<Result>(
    tenantContext: TenantContext,
    requirement: PermissionRequirement,
    operation: (
      scope: AuthorizedTenantOperation<Repositories>,
    ) => Promise<Result>,
  ): Promise<AuthorizedTenantPersistenceResult<Result>>;
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
