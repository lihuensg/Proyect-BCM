import type {
  CredentialRepository,
  PasswordIdentity,
} from "../application/credential-repository.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

export class CredentialPersistenceError extends Error {
  override readonly name = "CredentialPersistenceError";

  constructor() {
    super("The credential persistence operation failed.");
  }
}

function mapIdentity(
  input: Readonly<{
    id: string;
    status: string;
    credential: Readonly<{ passwordHash: string }> | null;
  }>,
): PasswordIdentity {
  return Object.freeze({
    userId: input.id,
    userStatus: input.status === "Active" ? "Active" : "Disabled",
    passwordHash: input.credential?.passwordHash ?? null,
  });
}

export class PrismaCredentialRepository implements CredentialRepository {
  constructor(private readonly client: PrismaClient) {}

  async findPasswordIdentityByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<PasswordIdentity | null> {
    try {
      const identity = await this.client.user.findUnique({
        where: { emailNormalized: normalizedEmail },
        select: {
          id: true,
          status: true,
          credential: { select: { passwordHash: true } },
        },
      });

      return identity === null ? null : mapIdentity(identity);
    } catch {
      throw new CredentialPersistenceError();
    }
  }

  async replacePasswordHashIfCurrent(
    input: Readonly<{
      userId: string;
      expectedPasswordHash: string;
      replacementPasswordHash: string;
      updatedAt: Date;
    }>,
  ): Promise<boolean> {
    try {
      const result = await this.client.userPasswordCredential.updateMany({
        where: {
          userId: input.userId,
          passwordHash: input.expectedPasswordHash,
        },
        data: {
          passwordHash: input.replacementPasswordHash,
          updatedAt: input.updatedAt,
        },
      });

      return result.count === 1;
    } catch {
      throw new CredentialPersistenceError();
    }
  }
}
