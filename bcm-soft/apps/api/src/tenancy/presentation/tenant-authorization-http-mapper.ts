import type { PinoLoggerAdapter } from "../../observability/pino-logger.adapter.js";
import type { AuthorizedTenantPersistenceResult } from "../application/tenant-persistence-scope.js";
import {
  authorizationDenied,
  staleAuthorizationDenied,
  tenantAccessDenied,
} from "./tenant-http-errors.js";

type AuthorizationLogger = Pick<PinoLoggerAdapter, "record">;

export class InvalidMembershipRoleError extends Error {
  constructor() {
    super("The Membership role is invalid.");
    this.name = "InvalidMembershipRoleError";
  }
}

export class InvalidPermissionRequirementError extends Error {
  constructor() {
    super("The PermissionRequirement is invalid.");
    this.name = "InvalidPermissionRequirementError";
  }
}

export class TenantAuthorizationHttpMapper {
  constructor(private readonly logger: AuthorizationLogger) {}

  map<Result>(result: AuthorizedTenantPersistenceResult<Result>): Result {
    if (result.status === "executed") return result.value;
    if (result.status === "tenant-denied") throw tenantAccessDenied();

    switch (result.reason) {
      case "permission-denied":
        this.logger.record("warn", "authorization.denied", {
          module: "tenancy",
          operation: "authorize",
          outcome: "denied",
        });
        throw authorizationDenied();
      case "stale-authorization":
        this.logger.record("warn", "authorization.stale", {
          module: "tenancy",
          operation: "authorize",
          outcome: "denied",
        });
        throw staleAuthorizationDenied();
      case "invalid-membership-role":
        this.logger.record("error", "authorization.membership-role.invalid", {
          module: "tenancy",
          operation: "authorize",
          outcome: "failure",
        });
        throw new InvalidMembershipRoleError();
      case "invalid-permission-requirement":
        this.logger.record("error", "authorization.requirement.invalid", {
          module: "tenancy",
          operation: "authorize",
          outcome: "failure",
        });
        throw new InvalidPermissionRequirementError();
    }
  }
}
