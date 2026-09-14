import { describe, expect, it, vi } from "vitest";
import { CredentialAuthenticator } from "./credential-authenticator.js";
import { SessionRenewalService } from "./session-renewal-service.js";
import type { SessionReplacement } from "./session-replacement.js";
import { NodeSessionTokenService } from "../infrastructure/node-session-token-service.js";
import { generateUuidV7 } from "../../infrastructure/identifiers/uuid-v7.js";

const PASSWORD = "  a long password 🔐  ";
const HASH = "synthetic-current-credential";
const policy = {
  absoluteLifetimeMilliseconds: 43_200_000,
  idleTimeoutMilliseconds: 1_800_000,
  touchIntervalMilliseconds: 60_000,
};

function fixture() {
  const tokens = new NodeSessionTokenService();
  const input = {
    userId: generateUuidV7(),
    sessionId: generateUuidV7(),
    rawToken: tokens.generate(),
    password: PASSWORD,
    clientIp: "127.0.0.1",
  };
  const now = new Date("2026-09-08T00:00:00Z");
  const replacement = {
    findPasswordIdentityByUserId: vi
      .fn<SessionReplacement["findPasswordIdentityByUserId"]>()
      .mockResolvedValue({
        userId: input.userId,
        userStatus: "Active",
        passwordHash: HASH,
      }),
    replace: vi
      .fn<SessionReplacement["replace"]>()
      .mockResolvedValue({ status: "replaced", selectionCleared: false }),
  };
  const verify = vi.fn(
    async (_hash: string, candidate: string) => candidate === PASSWORD,
  );
  const authenticator = new CredentialAuthenticator({
    verify,
    isSupportedHash: () => true,
    needsRehash: () => false,
    hash: async () => HASH,
  });
  const consume = vi.fn(async () => ({ allowed: true as const }));
  const audit = { recordRenewal: vi.fn() };
  const service = new SessionRenewalService(
    replacement,
    authenticator,
    { consumeForUser: consume },
    tokens,
    { now: () => now },
    generateUuidV7,
    policy,
    audit,
  );
  return { service, input, replacement, verify, consume, audit, tokens, now };
}

describe("explicit Session renewal", () => {
  it("proves the exact password and creates a fresh lifetime with digest-only replacement input", async () => {
    const f = fixture();
    const result = await f.service.execute(f.input);
    expect(result.status).toBe("renewed");
    if (result.status !== "renewed") throw new Error("Renewal failed.");
    expect(result.session.rawToken).not.toBe(f.input.rawToken);
    expect(result.session.sessionId).not.toBe(f.input.sessionId);
    expect(result.session.expiresAt.getTime() - f.now.getTime()).toBe(
      policy.absoluteLifetimeMilliseconds,
    );
    expect(f.verify).toHaveBeenCalledWith(HASH, PASSWORD);
    const replacement = f.replacement.replace.mock.calls[0]?.[0];
    expect(replacement).toMatchObject({
      sessionId: f.input.sessionId,
      userId: f.input.userId,
      verifiedPasswordHash: HASH,
      tokenHash: f.tokens.digest(f.input.rawToken),
    });
    expect(replacement?.replacement.tokenHash).toEqual(
      f.tokens.digest(result.session.rawToken),
    );
    expect(JSON.stringify(replacement)).not.toContain(result.session.rawToken);
    expect(JSON.stringify(replacement)).not.toContain(PASSWORD);
    expect(f.consume).toHaveBeenCalledWith({
      userId: f.input.userId,
      clientIp: "127.0.0.1",
    });
  });

  it("does not replace a Session after a wrong password", async () => {
    const f = fixture();
    expect(
      await f.service.execute({ ...f.input, password: PASSWORD.trim() }),
    ).toEqual({ status: "invalid" });
    expect(f.replacement.replace).not.toHaveBeenCalled();
    expect(f.audit.recordRenewal).toHaveBeenCalledWith("failed");
  });

  it.each([
    null,
    {
      userId: "unavailable",
      userStatus: "Disabled" as const,
      passwordHash: HASH,
    },
    {
      userId: "unavailable",
      userStatus: "Active" as const,
      passwordHash: null,
    },
  ])(
    "fails closed for an unavailable credential or inactive User",
    async (identity) => {
      const f = fixture();
      f.replacement.findPasswordIdentityByUserId.mockResolvedValue(identity);
      expect(await f.service.execute(f.input)).toEqual({ status: "invalid" });
      expect(f.replacement.replace).not.toHaveBeenCalled();
    },
  );

  it.each(["invalid", "authentication-required"] as const)(
    "preserves the safe transactional denial %s",
    async (status) => {
      const f = fixture();
      f.replacement.replace.mockResolvedValue({ status });
      expect(await f.service.execute(f.input)).toEqual({ status });
      expect(f.audit.recordRenewal).not.toHaveBeenCalledWith("succeeded");
    },
  );

  it("reports cleared selection only internally after commit", async () => {
    const f = fixture();
    f.replacement.replace.mockResolvedValue({
      status: "replaced",
      selectionCleared: true,
    });
    const result = await f.service.execute(f.input);
    expect(result.status).toBe("renewed");
    expect(result).not.toHaveProperty("selectionCleared");
    expect(f.audit.recordRenewal).toHaveBeenCalledWith("selection_cleared");
  });

  it("does not verify credentials when the persistent limit rejects the attempt", async () => {
    const f = fixture();
    const service = new SessionRenewalService(
      f.replacement,
      new CredentialAuthenticator({
        verify: f.verify,
        isSupportedHash: () => true,
        needsRehash: () => false,
        hash: async () => HASH,
      }),
      {
        consumeForUser: async () => ({ allowed: false, retryAfterSeconds: 60 }),
      },
      f.tokens,
      { now: () => f.now },
      generateUuidV7,
      policy,
      f.audit,
    );
    expect(await service.execute(f.input)).toEqual({
      status: "rate-limited",
      retryAfterSeconds: 60,
    });
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.replacement.findPasswordIdentityByUserId).not.toHaveBeenCalled();
  });

  it("does not claim success when replacement rolls back", async () => {
    const f = fixture();
    f.replacement.replace.mockRejectedValue(new Error("synthetic failure"));
    await expect(f.service.execute(f.input)).rejects.toThrow(
      "synthetic failure",
    );
    expect(f.audit.recordRenewal).not.toHaveBeenCalledWith("succeeded");
  });

  it("rejects a token source returning the old bearer", async () => {
    const f = fixture();
    vi.spyOn(f.tokens, "generate").mockReturnValue(f.input.rawToken);
    await expect(f.service.execute(f.input)).rejects.toThrow("fresh Session");
    expect(f.replacement.replace).not.toHaveBeenCalled();
  });
});
