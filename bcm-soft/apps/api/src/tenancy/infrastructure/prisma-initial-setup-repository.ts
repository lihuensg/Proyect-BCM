import type { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaUserProvisioningRepository } from "../../identity/infrastructure/prisma-user-provisioning-repository.js";
import type {
  InitialSetupRepository,
  InitialSetupWriteResult,
} from "../application/initial-setup.js";
import { TenantRepositoryScopeLease } from "../application/tenant-persistence-scope.js";
import {
  PrismaAuditRecordWriter,
  PrismaOrganizationMembershipRepository,
} from "./prisma-membership-administration-repositories.js";

const INITIAL_SETUP_LOCK = "bcm.initial-setup";
const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

class SetupRejected extends Error {
  constructor(readonly result: InitialSetupWriteResult) {
    super("Initial setup was rejected.");
    this.name = "SetupRejected";
  }
}

export class PrismaInitialSetupRepository implements InitialSetupRepository {
  constructor(private readonly client: PrismaClient) {}

  async isSetupRequired(): Promise<boolean> {
    const rows = await this.client.$queryRaw<Array<{ configured: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM organizations) AS configured
    `;
    return rows[0]?.configured === false;
  }

  async complete(
    input: Parameters<InitialSetupRepository["complete"]>[0],
  ): Promise<InitialSetupWriteResult> {
    try {
      return await this.client.$transaction(async (transaction) => {
        // Serializes concurrent setups; the check below is the authority.
        await transaction.$queryRaw`
          SELECT 1 AS locked
          FROM pg_advisory_xact_lock(hashtextextended(${INITIAL_SETUP_LOCK}, 0))
        `;
        const existing = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM organizations LIMIT 1
        `;
        if (existing.length > 0) return "already-configured";

        await transaction.$executeRaw`
          INSERT INTO organizations (id, name, status, timezone, created_at, updated_at)
          VALUES (${input.organizationId}::uuid, ${input.organizationName},
            'Active', ${DEFAULT_TIMEZONE}, ${input.now}, ${input.now})
        `;
        const lease = new TenantRepositoryScopeLease();
        try {
          const link = await new PrismaUserProvisioningRepository(
            transaction,
            lease,
          ).ensureUserLinkedTo({
            email: input.email,
            normalizedEmail: input.email,
            account: input.account,
            newUserId: input.newIdentifier(),
            newLinkId: input.newIdentifier(),
            now: input.now,
          });
          if (link.status !== "linked") throw new SetupRejected(link.status);

          await new PrismaOrganizationMembershipRepository(
            transaction,
            input.organizationId,
            lease,
          ).create({
            id: input.newIdentifier(),
            userId: link.userId,
            role: "Owner",
            now: input.now,
          });
          // Audit Records are RLS-protected; the context is this transaction's.
          await transaction.$queryRaw`
            SELECT set_config('bcm.current_organization_id', ${input.organizationId}, true)
          `;
          await new PrismaAuditRecordWriter(
            transaction,
            input.organizationId,
            lease,
          ).append({
            id: input.newIdentifier(),
            actorUserId: null,
            action: "organization.initialized",
            entityType: "Organization",
            entityId: input.organizationId,
            after: { name: input.organizationName, ownerUserId: link.userId },
            correlationId: input.correlationId,
            occurredAt: input.now,
          });
          return "completed";
        } finally {
          lease.close();
        }
      });
    } catch (error: unknown) {
      if (error instanceof SetupRejected) return error.result;
      throw error;
    }
  }
}
