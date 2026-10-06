export interface IdentityAudit {
  recordLogout(): void;
  recordOriginRejected(operation: "logout"): void;
  recordCsrfRejected(operation: "logout"): void;
}
