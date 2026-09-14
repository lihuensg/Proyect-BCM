import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type {
  SessionAuthorizationSnapshotProvider,
  SessionReplacement,
  SessionReplacementInput,
  SessionReplacementResult,
} from "../application/session-replacement.js";
import type { PasswordIdentity } from "../application/credential-repository.js";
import { isSessionExpired } from "../domain/session-policy.js";
import type { Clock } from "../application/clock.js";
import { SystemClock } from "./system-clock.js";

import {
  type NewSessionRecord,
  SessionPersistenceError,
  type SessionRepository,
  SessionTokenHashCollisionError,
  type SessionValidationRecord,
  type SessionUserStatus,
} from "../application/session-repository.js";

// Infrastructure composition only: Application receives the narrow provider,
// never Prisma. The same transaction owns the snapshot and both Session writes.
export type SessionSnapshotFactory = (
  transaction: Prisma.TransactionClient,
) => SessionAuthorizationSnapshotProvider;

function isTokenHashCollision(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;

  const candidate = error as Readonly<{
    code?: unknown;
    meta?: Readonly<{ target?: unknown }>;
  }>;
  if (candidate.code !== "P2002") return false;

  return containsTokenHashTarget(candidate.meta);
}

function containsTokenHashTarget(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:tokenHash|token_hash|uq_sessions__token_hash)/u.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsTokenHashTarget);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsTokenHashTarget);
  }
  return false;
}

function mapUserStatus(status: string): SessionUserStatus {
  return status === "Active" ? "Active" : "Disabled";
}

function toPrismaBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return bytes;
}

async function safePersistenceOperation<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await operation();
  } catch {
    throw new SessionPersistenceError();
  }
}

export class PrismaSessionRepository
  implements SessionRepository, SessionReplacement
{
  constructor(
    private readonly client: PrismaClient,
    private readonly snapshots?: SessionSnapshotFactory,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async findPasswordIdentityByUserId(
    userId: string,
  ): Promise<PasswordIdentity | null> {
    return safePersistenceOperation(async () => {
      const user = await this.client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
          credential: { select: { passwordHash: true } },
        },
      });
      return user === null
        ? null
        : {
            userId: user.id,
            userStatus: mapUserStatus(user.status),
            passwordHash: user.credential?.passwordHash ?? null,
          };
    });
  }

  async replace(
    input: SessionReplacementInput,
  ): Promise<SessionReplacementResult> {
    return safePersistenceOperation(() =>
      this.client.$transaction(async (transaction) => {
        // TEN-001/002 order: Session -> User -> credential -> Membership ->
        // Organization advisory. Argon2 has already finished outside this scope.
        const rows = await transaction.$queryRaw<
          Array<{
            userId: string;
            tokenHash: Uint8Array;
            organizationId: string | null;
            revokedAt: Date | null;
            expiresAt: Date;
            lastSeenAt: Date;
          }>
        >`
        SELECT user_id AS "userId", token_hash AS "tokenHash", current_organization_id AS "organizationId",
          revoked_at AS "revokedAt", expires_at AS "expiresAt", COALESCE(last_seen_at, created_at) AS "lastSeenAt"
        FROM sessions WHERE id = ${input.sessionId}::uuid FOR UPDATE
      `;
        const old = rows[0];
        if (
          old === undefined ||
          old.userId !== input.userId ||
          !Buffer.from(old.tokenHash).equals(input.tokenHash) ||
          old.revokedAt !== null ||
          isSessionExpired(
            this.clock.now(),
            old.expiresAt,
            old.lastSeenAt,
            input.idleTimeoutMilliseconds,
          )
        ) {
          return { status: "authentication-required" };
        }
        const users = await transaction.$queryRaw<
          Array<{ status: string }>
        >`SELECT status FROM users WHERE id = ${input.userId}::uuid FOR SHARE`;
        if (users[0]?.status !== "Active") return { status: "invalid" };
        const credentials = await transaction.$queryRaw<
          Array<{ passwordHash: string }>
        >`SELECT password_hash AS "passwordHash" FROM user_password_credentials WHERE user_id = ${input.userId}::uuid FOR SHARE`;
        if (credentials[0]?.passwordHash !== input.verifiedPasswordHash)
          return { status: "invalid" };
        if (this.snapshots === undefined) throw new SessionPersistenceError();
        const selection = await this.snapshots(transaction).resolveSelected(
          input.userId,
          old.organizationId,
        );
        if (
          input.replacement.userId !== input.userId ||
          input.replacement.id === input.sessionId ||
          input.replacement.tokenHash.equals(input.tokenHash)
        )
          throw new SessionPersistenceError();
        // A lock wait may have consumed the old Session's remaining lifetime.
        const now = this.clock.now();
        if (
          isSessionExpired(
            now,
            old.expiresAt,
            old.lastSeenAt,
            input.idleTimeoutMilliseconds,
          )
        )
          return { status: "authentication-required" };
        await transaction.session.create({
          data: {
            ...input.replacement,
            tokenHash: toPrismaBytes(input.replacement.tokenHash),
            currentOrganizationId: selection.organizationId,
            currentMembershipAuthorizationVersion:
              selection.authorizationVersion,
            revokedAt: null,
          },
        });
        await transaction.session.update({
          where: { id: input.sessionId },
          data: { revokedAt: now },
        });
        return {
          status: "replaced",
          selectionCleared:
            old.organizationId !== null && selection.organizationId === null,
        };
      }),
    );
  }

  async createForActiveUser(
    record: NewSessionRecord,
  ): Promise<"created" | "user-inactive"> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const users = await transaction.$queryRaw<Array<{ status: string }>>`
          SELECT status
          FROM users
          WHERE id = ${record.userId}::uuid
          FOR UPDATE
        `;

        if (users[0]?.status !== "Active") {
          return "user-inactive";
        }

        await transaction.session.create({
          data: {
            id: record.id,
            tokenHash: toPrismaBytes(record.tokenHash),
            userId: record.userId,
            currentOrganizationId: null,
            currentMembershipAuthorizationVersion: null,
            expiresAt: record.expiresAt,
            revokedAt: null,
            lastSeenAt: record.lastSeenAt,
            createdAt: record.createdAt,
          },
        });

        return "created";
      });
    } catch (error: unknown) {
      if (isTokenHashCollision(error)) {
        throw new SessionTokenHashCollisionError();
      }

      throw new SessionPersistenceError();
    }
  }

  async findForValidationByTokenHash(
    tokenHash: Buffer,
  ): Promise<SessionValidationRecord | null> {
    const session = await safePersistenceOperation(() =>
      this.client.session.findUnique({
        where: { tokenHash: toPrismaBytes(tokenHash) },
        include: { user: { select: { status: true } } },
      }),
    );

    if (session === null) return null;

    return {
      id: session.id,
      userId: session.userId,
      userStatus: mapUserStatus(session.user.status),
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      lastSeenAt: session.lastSeenAt ?? session.createdAt,
      createdAt: session.createdAt,
      selectedOrganizationId: session.currentOrganizationId,
      selectedMembershipAuthorizationVersion:
        session.currentMembershipAuthorizationVersion,
    };
  }

  async revokeByTokenHash(tokenHash: Buffer, revokedAt: Date): Promise<void> {
    await safePersistenceOperation(() =>
      this.client.session.updateMany({
        where: { tokenHash: toPrismaBytes(tokenHash), revokedAt: null },
        data: { revokedAt },
      }),
    );
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<void> {
    await safePersistenceOperation(() =>
      this.client.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      }),
    );
  }

  async touchLastSeenIfDue(
    input: Readonly<{
      sessionId: string;
      now: Date;
      idleTimeoutMilliseconds: number;
      touchIntervalMilliseconds: number;
    }>,
  ): Promise<boolean> {
    const idleBoundary = new Date(
      input.now.getTime() - input.idleTimeoutMilliseconds,
    );
    const touchBoundary = new Date(
      input.now.getTime() - input.touchIntervalMilliseconds,
    );
    const count = await safePersistenceOperation(
      () => this.client.$executeRaw`
        UPDATE sessions
        SET last_seen_at = ${input.now}
        WHERE id = ${input.sessionId}::uuid
          AND revoked_at IS NULL
          AND expires_at > ${input.now}
          AND COALESCE(last_seen_at, created_at) > ${idleBoundary}
          AND COALESCE(last_seen_at, created_at) <= ${touchBoundary}
          AND COALESCE(last_seen_at, created_at) < ${input.now}
      `,
    );

    return count === 1;
  }
}
