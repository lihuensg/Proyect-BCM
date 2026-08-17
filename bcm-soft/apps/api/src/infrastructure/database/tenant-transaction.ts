import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { validate, version } from "uuid";

type TenantTransactionWork<Result> = (
  transaction: Prisma.TransactionClient,
) => Promise<Result>;

function normalizeOrganizationId(organizationId: string): string {
  const normalized = organizationId.trim().toLowerCase();

  if (!validate(normalized) || version(normalized) !== 7) {
    throw new Error("A valid UUIDv7 organization identifier is required.");
  }

  return normalized;
}

export async function withTenantTransaction<Result>(
  client: PrismaClient,
  organizationId: string,
  work: TenantTransactionWork<Result>,
): Promise<Result> {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);

  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ set_config: string }>>`
      SELECT set_config(
        'bcm.current_organization_id',
        ${normalizedOrganizationId},
        true
      )
    `;

    return work(transaction);
  });
}
