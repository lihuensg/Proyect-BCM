import type { IdentifierGenerator } from "../../infrastructure/identifiers/uuid-v7.js";
import {
  isSessionExpired,
  isSessionTouchDue,
  type SessionPolicy,
} from "../domain/session-policy.js";
import type { Clock } from "./clock.js";
import {
  type SessionRepository,
  SessionTokenHashCollisionError,
} from "./session-repository.js";
import type { SessionTokenService } from "./session-token-service.js";

const MAX_SESSION_CREATION_ATTEMPTS = 3;
const INVALID_SESSION_RESULT = Object.freeze({ status: "invalid" as const });

export type SessionValidationResult =
  | typeof INVALID_SESSION_RESULT
  | Readonly<{
      status: "valid";
      sessionId: string;
      userId: string;
      expiresAt: Date;
      selectedOrganizationId: string | null;
      selectedMembershipAuthorizationVersion: bigint | null;
    }>;

export type CreatedSession = Readonly<{
  sessionId: string;
  rawToken: string;
  expiresAt: Date;
}>;

export class SessionCreationError extends Error {
  constructor() {
    super("The session could not be created.");
    this.name = "SessionCreationError";
  }
}

export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly tokenService: SessionTokenService,
    private readonly clock: Clock,
    private readonly generateIdentifier: IdentifierGenerator,
    private readonly policy: SessionPolicy,
  ) {}

  async createSession(userId: string): Promise<CreatedSession> {
    const createdAt = this.clock.now();
    const expiresAt = new Date(
      createdAt.getTime() + this.policy.absoluteLifetimeMilliseconds,
    );

    for (
      let attempt = 1;
      attempt <= MAX_SESSION_CREATION_ATTEMPTS;
      attempt += 1
    ) {
      const rawToken = this.tokenService.generate();
      const sessionId = this.generateIdentifier();

      try {
        const outcome = await this.repository.createForActiveUser({
          id: sessionId,
          tokenHash: this.tokenService.digest(rawToken),
          userId,
          expiresAt,
          lastSeenAt: createdAt,
          createdAt,
        });

        if (outcome === "user-inactive") {
          throw new SessionCreationError();
        }

        return Object.freeze({
          sessionId,
          rawToken,
          expiresAt,
        });
      } catch (error: unknown) {
        if (!(error instanceof SessionTokenHashCollisionError)) {
          throw error;
        }

        if (attempt === MAX_SESSION_CREATION_ATTEMPTS) {
          throw new SessionCreationError();
        }
      }
    }

    throw new SessionCreationError();
  }

  async validateSession(rawToken: string): Promise<SessionValidationResult> {
    if (!this.tokenService.isValidFormat(rawToken)) {
      return INVALID_SESSION_RESULT;
    }

    const tokenHash = this.tokenService.digest(rawToken);
    const session =
      await this.repository.findForValidationByTokenHash(tokenHash);
    const now = this.clock.now();

    if (
      session === null ||
      session.revokedAt !== null ||
      session.userStatus !== "Active" ||
      isSessionExpired(
        now,
        session.expiresAt,
        session.lastSeenAt,
        this.policy.idleTimeoutMilliseconds,
      )
    ) {
      return INVALID_SESSION_RESULT;
    }

    if (
      isSessionTouchDue(
        now,
        session.lastSeenAt,
        this.policy.touchIntervalMilliseconds,
      )
    ) {
      await this.repository.touchLastSeenIfDue({
        sessionId: session.id,
        now,
        idleTimeoutMilliseconds: this.policy.idleTimeoutMilliseconds,
        touchIntervalMilliseconds: this.policy.touchIntervalMilliseconds,
      });
    }

    return Object.freeze({
      status: "valid",
      sessionId: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      selectedOrganizationId: session.selectedOrganizationId,
      selectedMembershipAuthorizationVersion:
        session.selectedMembershipAuthorizationVersion,
    });
  }

  async revokeSession(rawToken: string): Promise<void> {
    if (!this.tokenService.isValidFormat(rawToken)) {
      return;
    }

    await this.repository.revokeByTokenHash(
      this.tokenService.digest(rawToken),
      this.clock.now(),
    );
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.repository.revokeAllForUser(userId, this.clock.now());
  }
}
