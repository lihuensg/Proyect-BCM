import { assertPasswordPolicy } from "../domain/password-policy.js";
import type { PasswordHasher } from "./password-hasher.js";

export type UserStatus = "Active" | "Disabled";

export type CredentialAuthenticationInput = Readonly<{
  userStatus: UserStatus | null;
  storedPasswordHash: string | null;
  candidatePassword: string;
}>;

export type CredentialAuthenticationResult =
  | Readonly<{ status: "authenticated"; rehashRequired: boolean }>
  | Readonly<{ status: "invalid" }>;

export const DEFAULT_DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$QkNNLURVTU1ZLVNBTFQxIQ$nAr+uSuT6I2D1gkC2Nhwy1FczFNRg8xMNApvL3ejM4A";

const INVALID_RESULT: CredentialAuthenticationResult = Object.freeze({
  status: "invalid",
});
const INVALID_PASSWORD_PLACEHOLDER = "BCM invalid password placeholder v1";

function prepareCandidatePassword(candidatePassword: string): Readonly<{
  password: string;
  satisfiesPolicy: boolean;
}> {
  try {
    assertPasswordPolicy(candidatePassword);
    return { password: candidatePassword, satisfiesPolicy: true };
  } catch {
    return {
      password: INVALID_PASSWORD_PLACEHOLDER,
      satisfiesPolicy: false,
    };
  }
}

export class CredentialAuthenticator {
  constructor(
    private readonly passwordHasher: PasswordHasher,
    private readonly dummyPasswordHash = DEFAULT_DUMMY_PASSWORD_HASH,
  ) {}

  async authenticate(
    input: CredentialAuthenticationInput,
  ): Promise<CredentialAuthenticationResult> {
    const hasSupportedStoredHash =
      input.storedPasswordHash !== null &&
      this.passwordHasher.isSupportedHash(input.storedPasswordHash);
    const passwordHash = hasSupportedStoredHash
      ? input.storedPasswordHash
      : this.dummyPasswordHash;
    const candidate = prepareCandidatePassword(input.candidatePassword);
    const passwordMatches = await this.passwordHasher.verify(
      passwordHash,
      candidate.password,
    );

    if (
      !candidate.satisfiesPolicy ||
      !passwordMatches ||
      input.userStatus !== "Active" ||
      !hasSupportedStoredHash
    ) {
      return INVALID_RESULT;
    }

    return Object.freeze({
      status: "authenticated",
      rehashRequired: this.passwordHasher.needsRehash(passwordHash),
    });
  }
}
