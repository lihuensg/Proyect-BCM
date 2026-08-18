import type { RateLimitRuleConfig } from "../../config/server-config.js";
import type { Clock } from "./clock.js";
import type { LoginRateLimitResult } from "./login-rate-limiter.js";
import type { NodeRateLimitFingerprint } from "../infrastructure/node-rate-limit-fingerprint.js";

type Entry = { count: number; windowStartedAt: number; blockedUntil: number };

export class LocalNetworkRateLimiter {
  readonly #entries = new Map<string, Entry>();

  constructor(
    private readonly fingerprints: NodeRateLimitFingerprint,
    private readonly clock: Clock,
    private readonly rule: RateLimitRuleConfig,
    private readonly maximumEntries = 10_000,
  ) {}

  consume(clientIp: string): LoginRateLimitResult {
    const now = this.clock.now().getTime();
    const key = this.fingerprints.network(clientIp).toString("hex");
    this.prune(now);
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = {
        count: 0,
        windowStartedAt: now - (now % this.rule.windowMilliseconds),
        blockedUntil: 0,
      };
    } else if (now >= entry.windowStartedAt + this.rule.windowMilliseconds) {
      entry = {
        count: 0,
        windowStartedAt: now - (now % this.rule.windowMilliseconds),
        blockedUntil: entry.blockedUntil > now ? entry.blockedUntil : 0,
      };
    }
    entry.count += 1;
    if (entry.count > this.rule.maximumAttempts && entry.blockedUntil <= now) {
      entry.blockedUntil = now + this.rule.blockMilliseconds;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    if (entry.blockedUntil <= now) return Object.freeze({ allowed: true });
    return Object.freeze({
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((entry.blockedUntil - now) / 1_000),
      ),
    });
  }

  private prune(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (
        entry.blockedUntil <= now &&
        entry.windowStartedAt + this.rule.windowMilliseconds <= now
      ) {
        this.#entries.delete(key);
      }
    }
    while (this.#entries.size >= this.maximumEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }
}
