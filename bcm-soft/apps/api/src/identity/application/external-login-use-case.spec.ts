import { describe, expect, it, vi } from "vitest";

import {
  type ExternalIdentityProvider,
  ExternalIdentityProviderError,
  type ExternalLoginAudit,
  ExternalLoginUseCase,
} from "./external-login-use-case.js";
import { SessionCreationError } from "./session-service.js";

const TRANSACTION = Object.freeze({
  state: "s".repeat(43),
  nonce: "n".repeat(43),
  codeVerifier: "v".repeat(43),
});
const SESSION = Object.freeze({
  sessionId: "session-1",
  rawToken: "token",
  expiresAt: new Date(0),
});

function setup(
  overrides: Readonly<{
    verify?: ExternalIdentityProvider["verifyAuthorizationCode"];
    userId?: string | null;
    createSession?: (userId: string) => Promise<typeof SESSION>;
  }> = {},
) {
  const provider: ExternalIdentityProvider = {
    authorizationUrl: vi.fn(),
    logoutUrl: vi.fn(),
    verifyAuthorizationCode:
      overrides.verify ??
      vi.fn(async () => ({ provider: "auth0" as const, subject: "auth0|1" })),
  };
  const identities = {
    findUserIdBySubject: vi.fn(async () =>
      overrides.userId === undefined ? "user-1" : overrides.userId,
    ),
  };
  const sessions = {
    createSession: vi.fn(overrides.createSession ?? (async () => SESSION)),
  };
  const audit: ExternalLoginAudit = {
    recordExternalLoginSucceeded: vi.fn(),
    recordExternalLoginDenied: vi.fn(),
  };
  return {
    useCase: new ExternalLoginUseCase(provider, identities, sessions, audit),
    provider,
    identities,
    sessions,
    audit,
  };
}

describe("ExternalLoginUseCase", () => {
  it("creates a Session for the User linked to the verified subject", async () => {
    const { useCase, provider, identities, sessions, audit } = setup();

    await expect(
      useCase.complete({ transaction: TRANSACTION, code: "code-1" }),
    ).resolves.toEqual({ status: "authenticated", session: SESSION });
    expect(provider.verifyAuthorizationCode).toHaveBeenCalledWith({
      code: "code-1",
      codeVerifier: TRANSACTION.codeVerifier,
      nonce: TRANSACTION.nonce,
    });
    expect(identities.findUserIdBySubject).toHaveBeenCalledWith(
      "auth0",
      "auth0|1",
    );
    expect(sessions.createSession).toHaveBeenCalledWith("user-1");
    expect(audit.recordExternalLoginSucceeded).toHaveBeenCalledWith("user-1");
  });

  it("denies provider failures without looking up any User", async () => {
    const { useCase, identities, audit } = setup({
      verify: async () => {
        throw new ExternalIdentityProviderError();
      },
    });

    await expect(
      useCase.complete({ transaction: TRANSACTION, code: "code-1" }),
    ).resolves.toEqual({ status: "denied", reason: "provider-error" });
    expect(identities.findUserIdBySubject).not.toHaveBeenCalled();
    expect(audit.recordExternalLoginDenied).toHaveBeenCalledWith(
      "provider-error",
    );
  });

  it("denies a verified subject that was never provisioned", async () => {
    const { useCase, sessions } = setup({ userId: null });

    await expect(
      useCase.complete({ transaction: TRANSACTION, code: "code-1" }),
    ).resolves.toEqual({ status: "denied", reason: "not-provisioned" });
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it("denies a linked but disabled User", async () => {
    const { useCase, audit } = setup({
      createSession: async () => {
        throw new SessionCreationError();
      },
    });

    await expect(
      useCase.complete({ transaction: TRANSACTION, code: "code-1" }),
    ).resolves.toEqual({ status: "denied", reason: "session-refused" });
    expect(audit.recordExternalLoginSucceeded).not.toHaveBeenCalled();
  });

  it("propagates unexpected failures instead of reporting a denial", async () => {
    const failure = new Error("database unavailable");
    const { useCase } = setup({
      createSession: async () => {
        throw failure;
      },
    });

    await expect(
      useCase.complete({ transaction: TRANSACTION, code: "code-1" }),
    ).rejects.toBe(failure);
  });
});
