import type { PasswordIdentity } from "./credential-repository.js";
import type { NewSessionRecord } from "./session-repository.js";

export type SessionAuthorizationSelection =
  | Readonly<{ organizationId: null; authorizationVersion: null }>
  | Readonly<{ organizationId: string; authorizationVersion: bigint }>;

// Bound to the replacement transaction by Infrastructure. Never selects a
// candidate when the old Session has no selection.
export interface SessionAuthorizationSnapshotProvider {
  resolveSelected(
    userId: string,
    organizationId: string | null,
  ): Promise<SessionAuthorizationSelection>;
}

export type SessionReplacementInput = Readonly<{
  sessionId: string;
  userId: string;
  tokenHash: Buffer;
  verifiedPasswordHash: string;
  replacement: NewSessionRecord;
  idleTimeoutMilliseconds: number;
}>;

export type SessionReplacementResult =
  | Readonly<{ status: "replaced"; selectionCleared: boolean }>
  | Readonly<{ status: "authentication-required" }>
  | Readonly<{ status: "invalid" }>;

export interface SessionReplacement {
  findPasswordIdentityByUserId(
    userId: string,
  ): Promise<PasswordIdentity | null>;
  replace(input: SessionReplacementInput): Promise<SessionReplacementResult>;
}

export interface SessionRenewalAudit {
  recordRenewal(
    outcome: "succeeded" | "failed" | "rate_limited" | "selection_cleared",
  ): void;
}
