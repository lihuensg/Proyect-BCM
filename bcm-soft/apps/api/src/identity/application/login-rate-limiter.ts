export type LoginRateLimitDimension =
  "Identity" | "Network" | "IdentityNetwork";

export type LoginRateLimitAttempt = Readonly<{
  dimension: LoginRateLimitDimension;
  fingerprint: Buffer;
  fingerprintVersion: 1;
  maximumAttempts: number;
  windowMilliseconds: number;
  blockMilliseconds: number;
}>;

export interface LoginRateLimitStore {
  consume(
    attempts: readonly LoginRateLimitAttempt[],
    now: Date,
  ): Promise<Date | null>;
}

export type LoginRateLimitResult =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; retryAfterSeconds: number }>;

export interface LoginRateLimiter {
  consume(
    input: Readonly<{ normalizedEmail: string; clientIp: string }>,
  ): Promise<LoginRateLimitResult>;
}
