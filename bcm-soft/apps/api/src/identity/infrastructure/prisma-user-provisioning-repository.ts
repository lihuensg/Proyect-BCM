import type { Prisma } from "../../generated/prisma/client.js";
import type {
  UserLinkResult,
  UserProvisioningRepository,
} from "../application/user-provisioning.js";

type ScopeLease = Readonly<{ assertActive(): void }>;

const USER_DISABLED: UserLinkResult = Object.freeze({
  status: "user-disabled",
});
const IDENTITY_CONFLICT: UserLinkResult = Object.freeze({
  status: "identity-conflict",
});

/**
 * Bound to one caller-owned transaction. Conflicts use ON CONFLICT DO NOTHING
 * instead of catching unique violations, which would abort the transaction.
 */
export class PrismaUserProvisioningRepository implements UserProvisioningRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly lease: ScopeLease,
  ) {}

  async findUserIdByEmail(normalizedEmail: string): Promise<string | null> {
    this.lease.assertActive();
    const rows = await this.transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users WHERE email_normalized = ${normalizedEmail}
    `;
    return rows[0]?.id ?? null;
  }

  async ensureUserLinkedTo(
    input: Parameters<UserProvisioningRepository["ensureUserLinkedTo"]>[0],
  ): Promise<UserLinkResult> {
    this.lease.assertActive();
    await this.transaction.$executeRaw`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at)
      VALUES (${input.newUserId}::uuid, ${input.email}, ${input.normalizedEmail},
        'Active', ${input.now}, ${input.now})
      ON CONFLICT (email_normalized) DO NOTHING
    `;
    const users = await this.transaction.$queryRaw<
      Array<{ id: string; status: string }>
    >`
      SELECT id, status FROM users
      WHERE email_normalized = ${input.normalizedEmail}
      FOR UPDATE
    `;
    const user = users[0];
    if (user === undefined) throw new Error("The provisioned User is missing.");
    if (user.status !== "Active") return USER_DISABLED;

    const { provider, subject } = input.account;
    const inserted = await this.transaction.$executeRaw`
      INSERT INTO user_external_identities (id, user_id, provider, subject, created_at)
      VALUES (${input.newLinkId}::uuid, ${user.id}::uuid, ${provider}, ${subject}, ${input.now})
      ON CONFLICT DO NOTHING
    `;
    if (inserted === 1)
      return Object.freeze({ status: "linked", userId: user.id });

    // Already linked: accept only the exact same User/subject pair.
    const links = await this.transaction.$queryRaw<Array<{ userId: string }>>`
      SELECT user_id AS "userId" FROM user_external_identities
      WHERE provider = ${provider} AND subject = ${subject}
    `;
    return links[0]?.userId === user.id
      ? Object.freeze({ status: "linked", userId: user.id })
      : IDENTITY_CONFLICT;
  }

  async findEmailsByUserIds(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    this.lease.assertActive();
    if (userIds.length === 0) return new Map();
    const rows = await this.transaction.$queryRaw<
      Array<{ id: string; email: string }>
    >`
      SELECT id, email FROM users WHERE id = ANY(${[...userIds]}::uuid[])
    `;
    return new Map(rows.map((row) => [row.id, row.email]));
  }
}
