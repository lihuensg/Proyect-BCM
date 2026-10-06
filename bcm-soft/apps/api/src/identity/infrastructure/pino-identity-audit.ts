import type {
  ExternalLoginAudit,
  ExternalLoginDenialReason,
} from "../application/external-login-use-case.js";
import type { IdentityAudit } from "../application/identity-audit.js";
import type { PinoLoggerAdapter } from "../../observability/pino-logger.adapter.js";

export class PinoIdentityAudit implements IdentityAudit, ExternalLoginAudit {
  constructor(private readonly logger: PinoLoggerAdapter) {}

  recordExternalLoginSucceeded(userId: string): void {
    this.logger.record("info", "identity.external_login.succeeded", {
      operation: "external-login",
      outcome: "succeeded",
      provider: "auth0",
      userId,
      auditDurability: "diagnostic-only",
    });
  }

  recordExternalLoginDenied(reason: ExternalLoginDenialReason): void {
    this.logger.record(
      reason === "provider-error" ? "error" : "warn",
      "identity.external_login.denied",
      {
        operation: "external-login",
        outcome: "denied",
        provider: "auth0",
        reason,
        auditDurability: "diagnostic-only",
      },
    );
  }

  recordPasswordSetupEmailFailed(): void {
    this.logger.record("error", "identity.password_setup_email.failed", {
      operation: "membership-provisioning",
      outcome: "failed",
      provider: "auth0",
      auditDurability: "diagnostic-only",
    });
  }

  recordLogout(): void {
    this.logger.record("info", "identity.logout", {
      operation: "logout",
      outcome: "completed",
      auditDurability: "diagnostic-only",
    });
  }

  recordOriginRejected(operation: "logout" | "setup" | "tenant-command"): void {
    this.logger.record("warn", "identity.origin.rejected", {
      operation,
      outcome: "rejected",
      auditDurability: "diagnostic-only",
    });
  }

  recordCsrfRejected(operation: "logout" | "tenant-command"): void {
    this.logger.record("warn", "identity.csrf.rejected", {
      operation,
      outcome: "rejected",
      auditDurability: "diagnostic-only",
    });
  }
}
