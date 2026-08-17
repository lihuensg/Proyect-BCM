import { randomBytes } from "node:crypto";

import {
  argon2d,
  argon2i,
  argon2id,
  hash as argon2Hash,
  type HashOptions,
} from "argon2";
import { describe, expect, it } from "vitest";

import {
  ARGON2_PASSWORD_POLICY,
  Argon2PasswordHasher,
  inspectArgon2Phc,
  PasswordHashingError,
  type Argon2Driver,
} from "./argon2-password-hasher.js";

const PASSWORD = "correct horse battery staple";

async function createPhc(overrides: HashOptions = {}): Promise<string> {
  return argon2Hash(Buffer.from(PASSWORD, "utf8"), {
    type: argon2id,
    version: 0x13,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
    salt: randomBytes(16),
    ...overrides,
  });
}

describe("Argon2PasswordHasher", () => {
  const hasher = new Argon2PasswordHasher();

  it("creates a self-describing Argon2id PHC with the explicit BCM policy", async () => {
    const passwordHash = await hasher.hash(PASSWORD);

    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$/u);
    expect(passwordHash).not.toContain(PASSWORD);
    expect(inspectArgon2Phc(passwordHash)).toEqual({
      algorithm: "argon2id",
      version: 19,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      saltLength: 16,
      hashLength: 32,
    });
    expect(ARGON2_PASSWORD_POLICY).toMatchObject({
      type: argon2id,
      version: 0x13,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      saltLength: 16,
      hashLength: 32,
    });
  });

  it("uses a unique salt for every hash and verifies both", async () => {
    const firstHash = await hasher.hash(PASSWORD);
    const secondHash = await hasher.hash(PASSWORD);

    expect(firstHash).not.toBe(secondHash);
    await expect(hasher.verify(firstHash, PASSWORD)).resolves.toBe(true);
    await expect(hasher.verify(secondHash, PASSWORD)).resolves.toBe(true);
  });

  it("returns false for an incorrect password", async () => {
    const passwordHash = await hasher.hash(PASSWORD);

    await expect(hasher.verify(passwordHash, `${PASSWORD}!`)).resolves.toBe(
      false,
    );
  });

  it("rejects an overlong candidate before invoking the native addon", async () => {
    const driver: Argon2Driver = {
      hash: async () => "unused",
      verify: async () => {
        throw new Error("native addon should not run");
      },
    };
    const boundedHasher = new Argon2PasswordHasher(driver);

    await expect(
      boundedHasher.verify(
        "$argon2id$v=19$m=19456,t=2,p=1$QkNNLURVTU1ZLVNBTFQxIQ$nAr+uSuT6I2D1gkC2Nhwy1FczFNRg8xMNApvL3ejM4A",
        "x".repeat(129),
      ),
    ).resolves.toBe(false);
  });

  it("preserves Unicode and leading or trailing spaces exactly", async () => {
    const password = "  contraseña segura 😀  ";
    const passwordHash = await hasher.hash(password);

    await expect(hasher.verify(passwordHash, password)).resolves.toBe(true);
    await expect(hasher.verify(passwordHash, password.trim())).resolves.toBe(
      false,
    );
  });

  it("does not normalize Unicode before hashing or verification", async () => {
    const composed = "é".repeat(15);
    const decomposed = "e\u0301".repeat(15);
    const passwordHash = await hasher.hash(composed);

    await expect(hasher.verify(passwordHash, composed)).resolves.toBe(true);
    await expect(hasher.verify(passwordHash, decomposed)).resolves.toBe(false);
  });

  it("recognizes the current policy", async () => {
    const passwordHash = await hasher.hash(PASSWORD);

    expect(hasher.needsRehash(passwordHash)).toBe(false);
  });

  it.each([
    ["memory", { memoryCost: 19_455 }],
    ["iterations", { timeCost: 1 }],
    ["parallelism", { parallelism: 2 }],
    ["version", { version: 0x10 }],
    ["salt length", { salt: randomBytes(15) }],
    ["digest length", { hashLength: 31 }],
  ] satisfies ReadonlyArray<readonly [string, HashOptions]>)(
    "requires rehash for a different %s",
    async (_name, options) => {
      const passwordHash = await createPhc(options);

      expect(hasher.needsRehash(passwordHash)).toBe(true);
    },
  );

  it.each([
    ["argon2i", argon2i],
    ["argon2d", argon2d],
  ] as const)("rejects %s hashes as unsupported", async (_name, type) => {
    const passwordHash = await createPhc({ type });

    await expect(hasher.verify(passwordHash, PASSWORD)).resolves.toBe(false);
    expect(hasher.needsRehash(passwordHash)).toBe(true);
  });

  it("fails closed for malformed or unsupported PHC values", async () => {
    const malformed = "$argon2id$v=19$m=19456,t=2,p=1$invalid";
    const unsupported = "$scrypt$v=1$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0";

    await expect(hasher.verify(malformed, PASSWORD)).resolves.toBe(false);
    await expect(hasher.verify(unsupported, PASSWORD)).resolves.toBe(false);
    expect(hasher.needsRehash(malformed)).toBe(true);
    expect(hasher.needsRehash(unsupported)).toBe(true);
  });

  it("sanitizes addon failures and never propagates their details", async () => {
    const sensitivePassword = "sensitive password value";
    const sensitivePhc = "$argon2id$sensitive-phc";
    const failingDriver: Argon2Driver = {
      hash: async () => {
        throw new Error(`${sensitivePassword} ${sensitivePhc}`);
      },
      verify: async () => {
        throw new Error(`${sensitivePassword} ${sensitivePhc}`);
      },
    };
    const failingHasher = new Argon2PasswordHasher(failingDriver);

    await expect(failingHasher.hash(sensitivePassword)).rejects.toEqual(
      new PasswordHashingError(),
    );
    await expect(
      failingHasher.verify(
        "$argon2id$v=19$m=19456,t=2,p=1$QkNNLURVTU1ZLVNBTFQxIQ$nAr+uSuT6I2D1gkC2Nhwy1FczFNRg8xMNApvL3ejM4A",
        sensitivePassword,
      ),
    ).resolves.toBe(false);
  });
});
