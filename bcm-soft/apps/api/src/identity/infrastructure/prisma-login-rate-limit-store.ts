import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type {
  LoginRateLimitAttempt,
  LoginRateLimitStore,
} from "../application/login-rate-limiter.js";
import { generateUuidV7 } from "../../infrastructure/identifiers/uuid-v7.js";

type BlockResult = Readonly<{ blocked_until: Date | null }>;

export class PrismaLoginRateLimitStore implements LoginRateLimitStore {
  constructor(private readonly prisma: PrismaClient) {}

  async consume(
    attempts: readonly LoginRateLimitAttempt[],
    now: Date,
  ): Promise<Date | null> {
    return this.prisma.$transaction(async (transaction) => {
      let latestBlock: Date | null = null;
      for (const attempt of attempts) {
        const windowStart = new Date(
          Math.floor(now.getTime() / attempt.windowMilliseconds) *
            attempt.windowMilliseconds,
        );
        const expiresAt = new Date(
          windowStart.getTime() +
            attempt.windowMilliseconds +
            attempt.blockMilliseconds,
        );
        const rows = await (transaction as Prisma.TransactionClient).$queryRaw<
          BlockResult[]
        >`
          WITH prior_block AS (
            SELECT max(blocked_until) AS blocked_until
            FROM identity_rate_limit_windows
            WHERE operation = 'Login'
              AND dimension = ${attempt.dimension}
              AND key_fingerprint = ${attempt.fingerprint}
              AND fingerprint_version = ${attempt.fingerprintVersion}
              AND blocked_until > ${now}
          ), consumed AS (
            INSERT INTO identity_rate_limit_windows
              (id, operation, dimension, key_fingerprint, fingerprint_version,
               window_started_at, expires_at, blocked_until, attempt_count, created_at, updated_at)
            VALUES
              (${generateUuidV7()}::uuid, 'Login', ${attempt.dimension}, ${attempt.fingerprint},
               ${attempt.fingerprintVersion}, ${windowStart}, ${expiresAt},
               CASE WHEN 1 > ${attempt.maximumAttempts}
                    THEN ${new Date(now.getTime() + attempt.blockMilliseconds)}::timestamptz
                    ELSE NULL::timestamptz END,
               1, ${now}, ${now})
            ON CONFLICT (operation, dimension, key_fingerprint, window_started_at)
            DO UPDATE SET
              attempt_count = identity_rate_limit_windows.attempt_count + 1,
              blocked_until = CASE
                WHEN identity_rate_limit_windows.attempt_count + 1 > ${attempt.maximumAttempts}
                THEN coalesce(
                  identity_rate_limit_windows.blocked_until,
                  ${new Date(now.getTime() + attempt.blockMilliseconds)}
                )
                ELSE identity_rate_limit_windows.blocked_until
              END,
              expires_at = greatest(identity_rate_limit_windows.expires_at, ${expiresAt}),
              updated_at = ${now}
            RETURNING blocked_until
          )
          SELECT greatest(prior_block.blocked_until, consumed.blocked_until) AS blocked_until
          FROM prior_block CROSS JOIN consumed
        `;
        const blockedUntil = rows[0]?.blocked_until ?? null;
        if (
          blockedUntil !== null &&
          (latestBlock === null || blockedUntil > latestBlock)
        ) {
          latestBlock = blockedUntil;
        }
      }
      return latestBlock;
    });
  }
}
