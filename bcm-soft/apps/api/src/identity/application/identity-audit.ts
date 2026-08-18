export interface IdentityAudit {
  recordLoginSucceeded(userId: string): void;
  recordLoginFailed(): void;
  recordLogout(): void;
}
