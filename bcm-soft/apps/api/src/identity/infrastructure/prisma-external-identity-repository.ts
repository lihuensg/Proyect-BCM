import type { PrismaClient } from "../../generated/prisma/client.js";
import type {
  ExternalIdentityProviderName,
  ExternalIdentityRepository,
} from "../application/external-login-use-case.js";

export class PrismaExternalIdentityRepository implements ExternalIdentityRepository {
  constructor(private readonly client: PrismaClient) {}

  async findUserIdBySubject(
    provider: ExternalIdentityProviderName,
    subject: string,
  ): Promise<string | null> {
    const identity = await this.client.userExternalIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
      select: { userId: true },
    });
    return identity?.userId ?? null;
  }
}
