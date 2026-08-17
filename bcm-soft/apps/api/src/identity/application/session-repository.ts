export type SessionUserStatus = "Active" | "Disabled";

export type NewSessionRecord = Readonly<{
  id: string;
  tokenHash: Buffer;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
}>;

export type SessionValidationRecord = Readonly<{
  id: string;
  userId: string;
  userStatus: SessionUserStatus;
  expiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date;
  createdAt: Date;
  selectedOrganizationId: string | null;
  selectedMembershipAuthorizationVersion: bigint | null;
}>;

export class SessionTokenHashCollisionError extends Error {
  constructor() {
    super("A session token hash collision occurred.");
    this.name = "SessionTokenHashCollisionError";
  }
}

export class SessionPersistenceError extends Error {
  constructor() {
    super("The session persistence operation failed.");
    this.name = "SessionPersistenceError";
  }
}

export interface SessionRepository {
  createForActiveUser(
    record: NewSessionRecord,
  ): Promise<"created" | "user-inactive">;
  findForValidationByTokenHash(
    tokenHash: Buffer,
  ): Promise<SessionValidationRecord | null>;
  revokeByTokenHash(tokenHash: Buffer, revokedAt: Date): Promise<void>;
  revokeAllForUser(userId: string, revokedAt: Date): Promise<void>;
  touchLastSeenIfDue(
    input: Readonly<{
      sessionId: string;
      now: Date;
      idleTimeoutMilliseconds: number;
      touchIntervalMilliseconds: number;
    }>,
  ): Promise<boolean>;
}
