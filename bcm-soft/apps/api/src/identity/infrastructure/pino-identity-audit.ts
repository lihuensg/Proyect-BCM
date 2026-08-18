import type { IdentityAudit } from "../application/identity-audit.js";
import type { PinoLoggerAdapter } from "../../observability/pino-logger.adapter.js";

export class PinoIdentityAudit implements IdentityAudit {
  constructor(private readonly logger: PinoLoggerAdapter) {}

  recordLoginSucceeded(userId: string): void {
    this.logger.record("info", "identity.login.succeeded", {
      operation: "login",
      outcome: "succeeded",
      userId,
      auditDurability: "diagnostic-only",
    });
  }

  recordLoginFailed(): void {
    this.logger.record("warn", "identity.login.failed", {
      operation: "login",
      outcome: "failed",
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
}
