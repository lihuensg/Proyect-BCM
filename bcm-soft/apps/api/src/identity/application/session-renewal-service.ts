import type { Clock } from "./clock.js";
import type { CredentialAuthenticator } from "./credential-authenticator.js";
import type { PasswordReauthenticationRateLimiter } from "./login-rate-limiter.js";
import type {
  SessionReplacement,
  SessionRenewalAudit,
} from "./session-replacement.js";
import type { CreatedSession } from "./session-service.js";
import type { SessionTokenService } from "./session-token-service.js";
import type { SessionPolicy } from "../domain/session-policy.js";
import type { IdentifierGenerator } from "../../infrastructure/identifiers/uuid-v7.js";

export type SessionRenewalResult =
  | Readonly<{ status: "renewed"; session: CreatedSession }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "authentication-required" }>
  | Readonly<{ status: "rate-limited"; retryAfterSeconds: number }>;

export class SessionRenewalService {
  constructor(
    private readonly replacement: SessionReplacement,
    private readonly authenticator: CredentialAuthenticator,
    private readonly limiter: PasswordReauthenticationRateLimiter,
    private readonly tokens: SessionTokenService,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
    private readonly policy: SessionPolicy,
    private readonly audit: SessionRenewalAudit,
  ) {}

  async execute(
    input: Readonly<{
      sessionId: string;
      userId: string;
      rawToken: string;
      password: string;
      clientIp: string;
    }>,
  ): Promise<SessionRenewalResult> {
    const limit = await this.limiter.consumeForUser({
      userId: input.userId,
      clientIp: input.clientIp,
    });
    if (!limit.allowed) {
      this.audit.recordRenewal("rate_limited");
      return {
        status: "rate-limited",
        retryAfterSeconds: limit.retryAfterSeconds,
      };
    }
    const identity = await this.replacement.findPasswordIdentityByUserId(
      input.userId,
    );
    const authentication = await this.authenticator.authenticate({
      userStatus: identity?.userStatus ?? null,
      storedPasswordHash: identity?.passwordHash ?? null,
      candidatePassword: input.password,
    });
    if (
      authentication.status !== "authenticated" ||
      identity === null ||
      identity.passwordHash === null ||
      identity.userId !== input.userId
    ) {
      this.audit.recordRenewal("failed");
      return { status: "invalid" };
    }
    const rawToken = this.tokens.generate();
    const sessionId = this.identifiers();
    if (
      rawToken === input.rawToken ||
      sessionId === input.sessionId ||
      !this.tokens.isValidFormat(rawToken)
    ) {
      throw new Error("A fresh Session could not be generated.");
    }
    const createdAt = this.clock.now();
    const expiresAt = new Date(
      createdAt.getTime() + this.policy.absoluteLifetimeMilliseconds,
    );
    const result = await this.replacement.replace({
      sessionId: input.sessionId,
      userId: input.userId,
      tokenHash: this.tokens.digest(input.rawToken),
      verifiedPasswordHash: identity.passwordHash,
      replacement: {
        id: sessionId,
        userId: input.userId,
        tokenHash: this.tokens.digest(rawToken),
        createdAt,
        lastSeenAt: createdAt,
        expiresAt,
      },
      idleTimeoutMilliseconds: this.policy.idleTimeoutMilliseconds,
    });
    if (result.status !== "replaced") {
      this.audit.recordRenewal("failed");
      return result;
    }
    if (result.selectionCleared) this.audit.recordRenewal("selection_cleared");
    this.audit.recordRenewal("succeeded");
    return { status: "renewed", session: { sessionId, rawToken, expiresAt } };
  }
}
