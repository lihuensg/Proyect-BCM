import type { RateLimitRuleConfig } from "../../config/server-config.js";
import type { Clock } from "./clock.js";
import type {
  LoginRateLimitAttempt,
  LoginRateLimiter,
  LoginRateLimitResult,
  LoginRateLimitStore,
} from "./login-rate-limiter.js";
import type { NodeRateLimitFingerprint } from "../infrastructure/node-rate-limit-fingerprint.js";

export class PersistentLoginRateLimiter implements LoginRateLimiter {
  constructor(
    private readonly store: LoginRateLimitStore,
    private readonly fingerprints: NodeRateLimitFingerprint,
    private readonly clock: Clock,
    private readonly rules: Readonly<{
      network: RateLimitRuleConfig;
      identity: RateLimitRuleConfig;
      identityNetwork: RateLimitRuleConfig;
    }>,
  ) {}

  async consume(
    input: Readonly<{ normalizedEmail: string; clientIp: string }>,
  ): Promise<LoginRateLimitResult> {
    const attempts: readonly LoginRateLimitAttempt[] = [
      this.attempt(
        "Network",
        this.fingerprints.network(input.clientIp),
        this.rules.network,
      ),
      this.attempt(
        "Identity",
        this.fingerprints.identity(input.normalizedEmail),
        this.rules.identity,
      ),
      this.attempt(
        "IdentityNetwork",
        this.fingerprints.identityNetwork(
          input.normalizedEmail,
          input.clientIp,
        ),
        this.rules.identityNetwork,
      ),
    ];
    const now = this.clock.now();
    const blockedUntil = await this.store.consume(attempts, now);
    if (blockedUntil === null) return Object.freeze({ allowed: true });
    return Object.freeze({
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000),
      ),
    });
  }

  private attempt(
    dimension: LoginRateLimitAttempt["dimension"],
    fingerprint: Buffer,
    rule: RateLimitRuleConfig,
  ): LoginRateLimitAttempt {
    return Object.freeze({
      dimension,
      fingerprint,
      fingerprintVersion: 1,
      ...rule,
    });
  }
}
