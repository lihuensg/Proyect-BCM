import { describe, expect, it, vi } from "vitest";

import { Argon2PasswordHasher } from "../infrastructure/argon2-password-hasher.js";
import {
  CredentialAuthenticator,
  DEFAULT_DUMMY_PASSWORD_HASH,
} from "./credential-authenticator.js";
import type { PasswordHasher } from "./password-hasher.js";

const PASSWORD = "correct horse battery staple";

function createHasherMock(
  passwordMatches: boolean,
  rehashRequired = false,
): PasswordHasher & {
  verify: ReturnType<typeof vi.fn<PasswordHasher["verify"]>>;
  needsRehash: ReturnType<typeof vi.fn<PasswordHasher["needsRehash"]>>;
} {
  return {
    hash: vi.fn<PasswordHasher["hash"]>(),
    verify: vi.fn<PasswordHasher["verify"]>(async () => passwordMatches),
    needsRehash: vi.fn<PasswordHasher["needsRehash"]>(() => rehashRequired),
  };
}

describe("CredentialAuthenticator", () => {
  it("authenticates an active user with a matching credential", async () => {
    const hasher = createHasherMock(true);
    const authenticator = new CredentialAuthenticator(hasher);

    await expect(
      authenticator.authenticate({
        userStatus: "Active",
        storedPasswordHash: "stored-phc",
        candidatePassword: PASSWORD,
      }),
    ).resolves.toEqual({ status: "authenticated", rehashRequired: false });
  });

  it("returns the same invalid outcome for wrong, disabled, and missing credentials", async () => {
    const wrongHasher = createHasherMock(false);
    const disabledHasher = createHasherMock(true);
    const missingHasher = createHasherMock(false);

    const wrong = await new CredentialAuthenticator(wrongHasher).authenticate({
      userStatus: "Active",
      storedPasswordHash: "stored-phc",
      candidatePassword: PASSWORD,
    });
    const disabled = await new CredentialAuthenticator(
      disabledHasher,
    ).authenticate({
      userStatus: "Disabled",
      storedPasswordHash: "stored-phc",
      candidatePassword: PASSWORD,
    });
    const missing = await new CredentialAuthenticator(
      missingHasher,
    ).authenticate({
      userStatus: null,
      storedPasswordHash: null,
      candidatePassword: PASSWORD,
    });

    expect(wrong).toEqual({ status: "invalid" });
    expect(disabled).toEqual(wrong);
    expect(missing).toEqual(wrong);
    expect(disabledHasher.verify).toHaveBeenCalledWith("stored-phc", PASSWORD);
    expect(missingHasher.verify).toHaveBeenCalledWith(
      DEFAULT_DUMMY_PASSWORD_HASH,
      PASSWORD,
    );
  });

  it("reports rehash only after successful authentication", async () => {
    const hasher = createHasherMock(true, true);
    const authenticator = new CredentialAuthenticator(hasher);

    await expect(
      authenticator.authenticate({
        userStatus: "Active",
        storedPasswordHash: "old-phc",
        candidatePassword: PASSWORD,
      }),
    ).resolves.toEqual({ status: "authenticated", rehashRequired: true });
    expect(hasher.needsRehash).toHaveBeenCalledOnce();
  });

  it("does not inspect rehash policy for invalid authentication", async () => {
    const hasher = createHasherMock(false, true);
    const authenticator = new CredentialAuthenticator(hasher);

    await authenticator.authenticate({
      userStatus: "Active",
      storedPasswordHash: "stored-phc",
      candidatePassword: PASSWORD,
    });

    expect(hasher.needsRehash).not.toHaveBeenCalled();
  });

  it("bounds an overlong candidate while preserving comparable verification work", async () => {
    const hasher = createHasherMock(true);
    const authenticator = new CredentialAuthenticator(hasher);
    const overlongPassword = "x".repeat(10_000);

    await expect(
      authenticator.authenticate({
        userStatus: null,
        storedPasswordHash: null,
        candidatePassword: overlongPassword,
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(hasher.verify).toHaveBeenCalledOnce();
    expect(hasher.verify).not.toHaveBeenCalledWith(
      DEFAULT_DUMMY_PASSWORD_HASH,
      overlongPassword,
    );
  });

  it("exercises the active, disabled, and missing paths with real Argon2", async () => {
    const hasher = new Argon2PasswordHasher();
    const passwordHash = await hasher.hash(PASSWORD);
    const authenticator = new CredentialAuthenticator(hasher);

    await expect(
      authenticator.authenticate({
        userStatus: "Active",
        storedPasswordHash: passwordHash,
        candidatePassword: PASSWORD,
      }),
    ).resolves.toEqual({ status: "authenticated", rehashRequired: false });
    await expect(
      authenticator.authenticate({
        userStatus: "Active",
        storedPasswordHash: passwordHash,
        candidatePassword: `${PASSWORD}!`,
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      authenticator.authenticate({
        userStatus: "Disabled",
        storedPasswordHash: passwordHash,
        candidatePassword: PASSWORD,
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      authenticator.authenticate({
        userStatus: null,
        storedPasswordHash: null,
        candidatePassword: PASSWORD,
      }),
    ).resolves.toEqual({ status: "invalid" });
  });
});
