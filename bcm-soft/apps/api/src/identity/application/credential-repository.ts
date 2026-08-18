import type { UserStatus } from "./credential-authenticator.js";

export type PasswordIdentity = Readonly<{
  userId: string;
  userStatus: UserStatus;
  passwordHash: string | null;
}>;

export interface CredentialRepository {
  findPasswordIdentityByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<PasswordIdentity | null>;
  replacePasswordHashIfCurrent(
    input: Readonly<{
      userId: string;
      expectedPasswordHash: string;
      replacementPasswordHash: string;
      updatedAt: Date;
    }>,
  ): Promise<boolean>;
}
