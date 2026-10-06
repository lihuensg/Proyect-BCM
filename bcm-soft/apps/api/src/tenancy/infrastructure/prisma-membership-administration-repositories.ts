import type { Prisma } from "../../generated/prisma/client.js";
import type {
  AuditRecordInput,
  AuditRecordWriter,
  MembershipRecord,
  OrganizationMembershipRepository,
} from "../application/membership-administration.js";
import type { TenantRepositoryScopeLease } from "../application/tenant-persistence-scope.js";

/** Every statement filters or writes the scope's own Organization. */
export class PrismaOrganizationMembershipRepository implements OrganizationMembershipRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly organizationId: string,
    private readonly lease: TenantRepositoryScopeLease,
  ) {}

  async existsForUser(userId: string): Promise<boolean> {
    this.lease.assertActive();
    const rows = await this.transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organization_memberships
      WHERE organization_id = ${this.organizationId}::uuid
        AND user_id = ${userId}::uuid
    `;
    return rows.length > 0;
  }

  async create(
    input: Parameters<OrganizationMembershipRepository["create"]>[0],
  ): Promise<void> {
    this.lease.assertActive();
    await this.transaction.$executeRaw`
      INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, authorization_version,
         activated_at, revoked_at, created_at, updated_at)
      VALUES (${input.id}::uuid, ${this.organizationId}::uuid, ${input.userId}::uuid,
        ${input.role}, 'Active', 1, ${input.now}, NULL, ${input.now}, ${input.now})
    `;
  }

  async list(
    input: Readonly<{ limit: number; afterId: string | null }>,
  ): Promise<readonly MembershipRecord[]> {
    this.lease.assertActive();
    return this.transaction.$queryRaw<MembershipRecord[]>`
      SELECT id, user_id AS "userId", role, status, created_at AS "createdAt"
      FROM organization_memberships
      WHERE organization_id = ${this.organizationId}::uuid
        AND (${input.afterId}::uuid IS NULL OR id > ${input.afterId}::uuid)
      ORDER BY id
      LIMIT ${input.limit}
    `;
  }
}

export class PrismaAuditRecordWriter implements AuditRecordWriter {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly organizationId: string,
    private readonly lease: TenantRepositoryScopeLease,
  ) {}

  async append(record: AuditRecordInput): Promise<void> {
    this.lease.assertActive();
    // No RETURNING: the runtime role is INSERT-only on audit_records, and RLS
    // WITH CHECK rejects any row outside the transaction's Organization.
    await this.transaction.$executeRaw`
      INSERT INTO audit_records
        (id, organization_id, actor_user_id, action, entity_type, entity_id,
         before, after, reason, correlation_id, occurred_at)
      VALUES (${record.id}::uuid, ${this.organizationId}::uuid,
        ${record.actorUserId}::uuid, ${record.action}, ${record.entityType},
        ${record.entityId}::uuid, NULL, ${JSON.stringify(record.after)}::jsonb,
        NULL, ${record.correlationId}, ${record.occurredAt})
    `;
  }
}
