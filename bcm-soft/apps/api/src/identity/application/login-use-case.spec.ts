import { describe, expect, it, vi } from "vitest";

import type { Clock } from "./clock.js";
import { CredentialAuthenticator } from "./credential-authenticator.js";
import type {
  CredentialRepository,
  PasswordIdentity,
} from "./credential-repository.js";
import type { IdentityAudit } from "./identity-audit.js";
import { LoginUseCase } from "./login-use-case.js";
import type { PasswordHasher } from "./password-hasher.js";

const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-08-17T12:00:00.000Z");
const ACTIVE_IDENTITY: PasswordIdentity = {
  userId: "0198d5a0-0000-7000-8000-000000000001",
  userStatus: "Active",
  passwordHash: "old-phc",
};

function fixture(identity: PasswordIdentity | null = ACTIVE_IDENTITY) {
  let currentIdentity = identity;
  const credentials: CredentialRepository = {
    findPasswordIdentityByNormalizedEmail: vi.fn(async () => currentIdentity),
    replacePasswordHashIfCurrent: vi.fn(async () => true),
  };
  const passwordHasher: PasswordHasher = {
    hash: vi.fn(async () => "new-phc"),
    verify: vi.fn(async (_hash, candidate) => candidate === PASSWORD),
    isSupportedHash: vi.fn((hash) => hash !== "malformed-phc"),
    needsRehash: vi.fn((hash) => hash === "old-phc"),
  };
  const sessions = {
    createSession: vi.fn(async () => ({
      sessionId: "session-id",
      rawToken: "A".repeat(43),
      expiresAt: new Date(NOW.getTime() + 43_200_000),
    })),
  };
  const audit: IdentityAudit = {
    recordLoginSucceeded: vi.fn(),
    recordLoginFailed: vi.fn(),
    recordLogout: vi.fn(),
  };
  const clock: Clock = { now: () => NOW };
  const useCase = new LoginUseCase(
    credentials,
    new CredentialAuthenticator(passwordHasher),
    passwordHasher,
    sessions,
    clock,
    audit,
  );

  return {
    audit,
    credentials,
    passwordHasher,
    sessions,
    setIdentity(value: PasswordIdentity | null) {
      currentIdentity = value;
    },
    useCase,
  };
}

describe("LoginUseCase", () => {
  it("normalizes lookup, rehashes with CAS, then creates a fresh session", async () => {
    const setup = fixture();

    await expect(
      setup.useCase.execute({
        email: "  USER@EXAMPLE.COM ",
        password: PASSWORD,
      }),
    ).resolves.toMatchObject({ status: "authenticated" });
    expect(
      setup.credentials.findPasswordIdentityByNormalizedEmail,
    ).toHaveBeenCalledWith("user@example.com");
    expect(setup.passwordHasher.hash).toHaveBeenCalledWith(PASSWORD);
    expect(setup.credentials.replacePasswordHashIfCurrent).toHaveBeenCalledWith(
      {
        userId: ACTIVE_IDENTITY.userId,
        expectedPasswordHash: "old-phc",
        replacementPasswordHash: "new-phc",
        updatedAt: NOW,
      },
    );
    expect(setup.sessions.createSession).toHaveBeenCalledWith(
      ACTIVE_IDENTITY.userId,
    );
    expect(setup.audit.recordLoginSucceeded).toHaveBeenCalledWith(
      ACTIVE_IDENTITY.userId,
    );
  });

  it("does not rehash a current credential", async () => {
    const setup = fixture({
      ...ACTIVE_IDENTITY,
      passwordHash: "current-phc",
    });

    await setup.useCase.execute({
      email: "user@example.com",
      password: PASSWORD,
    });

    expect(setup.passwordHasher.hash).not.toHaveBeenCalled();
    expect(
      setup.credentials.replacePasswordHashIfCurrent,
    ).not.toHaveBeenCalled();
    expect(setup.sessions.createSession).toHaveBeenCalledOnce();
  });

  it.each([
    ["unknown", null],
    ["missing credential", { ...ACTIVE_IDENTITY, passwordHash: null }],
    ["Disabled", { ...ACTIVE_IDENTITY, userStatus: "Disabled" as const }],
    ["malformed PHC", { ...ACTIVE_IDENTITY, passwordHash: "malformed-phc" }],
  ])(
    "uses the authenticator and creates no session for %s",
    async (_case, identity) => {
      const setup = fixture(identity);

      await expect(
        setup.useCase.execute({
          email: "user@example.com",
          password: PASSWORD,
        }),
      ).resolves.toEqual({ status: "invalid" });
      expect(setup.passwordHasher.verify).toHaveBeenCalledOnce();
      expect(setup.sessions.createSession).not.toHaveBeenCalled();
      expect(setup.audit.recordLoginFailed).toHaveBeenCalledOnce();
    },
  );

  it("fails closed when the password changes after verification and before CAS", async () => {
    const setup = fixture();
    vi.mocked(
      setup.credentials.replacePasswordHashIfCurrent,
    ).mockImplementation(async () => {
      setup.setIdentity({ ...ACTIVE_IDENTITY, passwordHash: "concurrent-phc" });
      return false;
    });

    await expect(
      setup.useCase.execute({
        email: "user@example.com",
        password: PASSWORD,
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(
      setup.credentials.findPasswordIdentityByNormalizedEmail,
    ).toHaveBeenCalledTimes(2);
    expect(setup.sessions.createSession).not.toHaveBeenCalled();
  });

  it("may continue after a lost CAS only when the credential remains exactly expected", async () => {
    const setup = fixture();
    vi.mocked(setup.credentials.replacePasswordHashIfCurrent).mockResolvedValue(
      false,
    );

    await expect(
      setup.useCase.execute({
        email: "user@example.com",
        password: PASSWORD,
      }),
    ).resolves.toMatchObject({ status: "authenticated" });
    expect(setup.sessions.createSession).toHaveBeenCalledOnce();
  });
});
