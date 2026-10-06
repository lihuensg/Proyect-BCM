import type { PrismaClient } from "../../generated/prisma/client.js";
import {
  type NewSessionRecord,
  SessionPersistenceError,
  type SessionRepository,
  SessionTokenHashCollisionError,
  type SessionValidationRecord,
  type SessionUserStatus,
} from "../application/session-repository.js";

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

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly client: PrismaClient) {}

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
