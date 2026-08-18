import type { Clock } from "./clock.js";
import type { CredentialAuthenticator } from "./credential-authenticator.js";
import type { CredentialRepository } from "./credential-repository.js";
import { normalizeIdentityEmail } from "./email-address.js";
import type { IdentityAudit } from "./identity-audit.js";
import type { PasswordHasher } from "./password-hasher.js";
import type { LoginRateLimiter } from "./login-rate-limiter.js";
import type { CreatedSession, SessionService } from "./session-service.js";

export type LoginResult =
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "rate-limited"; retryAfterSeconds: number }>
  | Readonly<{ status: "authenticated"; session: CreatedSession }>;

const INVALID_RESULT: LoginResult = Object.freeze({ status: "invalid" });

export class LoginUseCase {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly authenticator: CredentialAuthenticator,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: Pick<SessionService, "createSession">,
    private readonly clock: Clock,
    private readonly audit: IdentityAudit,
    private readonly rateLimiter: LoginRateLimiter,
  ) {}

  async execute(
    input: Readonly<{ email: unknown; password: string; clientIp: string }>,
  ): Promise<LoginResult> {
    const normalizedEmail = normalizeIdentityEmail(input.email);
    const rateLimit = await this.rateLimiter.consume({
      normalizedEmail,
      clientIp: input.clientIp,
    });
    if (!rateLimit.allowed) {
      this.audit.recordLoginRateLimited(rateLimit.retryAfterSeconds);
      return Object.freeze({
        status: "rate-limited",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }
    const identity =
      await this.credentials.findPasswordIdentityByNormalizedEmail(
        normalizedEmail,
      );
    const authentication = await this.authenticator.authenticate({
      userStatus: identity?.userStatus ?? null,
      storedPasswordHash: identity?.passwordHash ?? null,
      candidatePassword: input.password,
    });

    if (
      authentication.status === "invalid" ||
      identity === null ||
      identity.passwordHash === null
    ) {
      this.audit.recordLoginFailed();
      return INVALID_RESULT;
    }

    if (
      authentication.rehashRequired &&
      !(await this.rehashWithoutOverwritingConcurrentChange(
        normalizedEmail,
        identity.userId,
        identity.passwordHash,
        input.password,
      ))
    ) {
      this.audit.recordLoginFailed();
      return INVALID_RESULT;
    }

    const session = await this.sessions.createSession(identity.userId);
    this.audit.recordLoginSucceeded(identity.userId);
    return Object.freeze({ status: "authenticated", session });
  }

  private async rehashWithoutOverwritingConcurrentChange(
    normalizedEmail: string,
    userId: string,
    originalPasswordHash: string,
    password: string,
  ): Promise<boolean> {
    const replacementPasswordHash = await this.passwordHasher.hash(password);
    const replaced = await this.credentials.replacePasswordHashIfCurrent({
      userId,
      expectedPasswordHash: originalPasswordHash,
      replacementPasswordHash,
      updatedAt: this.clock.now(),
    });

    if (replaced) return true;

    const current =
      await this.credentials.findPasswordIdentityByNormalizedEmail(
        normalizedEmail,
      );

    return (
      current?.userId === userId &&
      current.userStatus === "Active" &&
      (current.passwordHash === originalPasswordHash ||
        current.passwordHash === replacementPasswordHash)
    );
  }
}
