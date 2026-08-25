import type { PrismaClient } from "../generated/prisma/client.js";
import type { IdentifierGenerator } from "../infrastructure/identifiers/uuid-v7.js";
import type { PasswordHasher } from "../identity/application/password-hasher.js";
import { normalizeIdentityEmail } from "../identity/application/email-address.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export class DevelopmentProvisioningError extends Error {
  override readonly name = "DevelopmentProvisioningError";
}

export type DevelopmentUserProvisioningResult = Readonly<{
  status: "created" | "already-exists";
  email: string;
  userId?: string;
}>;

export function assertDevelopmentDatabaseTarget(
  environment: NodeJS.ProcessEnv,
): URL {
  if (environment.NODE_ENV !== "development") {
    throw new DevelopmentProvisioningError(
      "Development user provisioning requires NODE_ENV=development.",
    );
  }

  const value = environment.DATABASE_URL;
  if (value === undefined || value.length === 0) {
    throw new DevelopmentProvisioningError(
      "Development user provisioning requires DATABASE_URL.",
    );
  }

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new DevelopmentProvisioningError(
      "Development user provisioning requires a valid PostgreSQL URL.",
    );
  }

  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !LOOPBACK_HOSTS.has(target.hostname) ||
    target.username.length === 0 ||
    target.password.length === 0 ||
    target.pathname.length <= 1
  ) {
    throw new DevelopmentProvisioningError(
      "Development user provisioning accepts only an authenticated loopback PostgreSQL target.",
    );
  }

  return target;
}

export async function provisionDevelopmentUser(input: {
  client: PrismaClient;
  email: unknown;
  password: string;
  passwordHasher: PasswordHasher;
  generateIdentifier: IdentifierGenerator;
  now?: () => Date;
}): Promise<DevelopmentUserProvisioningResult> {
  const emailNormalized = normalizeIdentityEmail(input.email);
  const email = (input.email as string).trim();
  const existing = await input.client.user.findUnique({
    where: { emailNormalized },
    select: { id: true },
  });

  if (existing !== null) {
    return Object.freeze({ status: "already-exists", email: emailNormalized });
  }

  const passwordHash = await input.passwordHasher.hash(input.password);
  const userId = input.generateIdentifier();
  const timestamp = input.now?.() ?? new Date();

  try {
    await input.client.$transaction(async (transaction) => {
      await transaction.user.create({
        data: {
          id: userId,
          email,
          emailNormalized,
          status: "Active",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      await transaction.userPasswordCredential.create({
        data: {
          userId,
          passwordHash,
          passwordChangedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return Object.freeze({
        status: "already-exists",
        email: emailNormalized,
      });
    }
    throw error;
  }

  return Object.freeze({ status: "created", email: emailNormalized, userId });
}

export function formatDevelopmentProvisioningResult(
  result: DevelopmentUserProvisioningResult,
): string {
  return result.status === "created"
    ? `Development user created: ${result.email}`
    : `Development user already exists: ${result.email}`;
}
