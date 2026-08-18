export interface IdentityAudit {
  recordLoginSucceeded(userId: string): void;
  recordLoginFailed(): void;
  recordLogout(): void;
  recordOriginRejected(operation: "login" | "logout"): void;
  recordCsrfRejected(operation: "logout"): void;
  recordLoginRateLimited(retryAfterSeconds: number): void;
}
