import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionDevelopmentUser } from "../../../src/development/development-user-provisioner.js";
import {
  Argon2PasswordHasher,
  inspectArgon2Phc,
} from "../../../src/identity/infrastructure/argon2-password-hasher.js";
import type { PasswordHasher } from "../../../src/identity/application/password-hasher.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";

describe("development user provisioning with PostgreSQL", () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for database integration tests.");
  }
  const lifecycle = new PrismaClientLifecycle(databaseUrl);
  const hasher = new Argon2PasswordHasher();

  beforeAll(async () => {
    await lifecycle.connect();
  });

  afterAll(async () => {
    await lifecycle.disconnect();
  });

  it("normalizes email and atomically creates an Active user with real Argon2id", async () => {
    const email = `  Dev.User.${generateUuidV7()}@BCM.Local  `;
    const password = "synthetic development password";
    const result = await provisionDevelopmentUser({
      client: lifecycle.client,
      email,
      password,
      passwordHasher: hasher,
      generateIdentifier: generateUuidV7,
    });

    expect(result.status).toBe("created");
    const persisted = await lifecycle.client.user.findUniqueOrThrow({
      where: { emailNormalized: email.trim().toLowerCase() },
      include: { credential: true },
    });
    expect(persisted).toMatchObject({
      email: email.trim(),
      emailNormalized: email.trim().toLowerCase(),
      status: "Active",
    });
    expect(persisted.credential).not.toBeNull();
    if (persisted.credential === null) {
      throw new Error("The provisioned password credential is missing.");
    }
    expect(inspectArgon2Phc(persisted.credential.passwordHash)?.algorithm).toBe(
      "argon2id",
    );
    await expect(
      hasher.verify(persisted.credential.passwordHash, password),
    ).resolves.toBe(true);
  });

  it("returns already-exists without creating or changing credentials", async () => {
    const email = `duplicate.${generateUuidV7()}@bcm.local`;
    const originalPassword = "original synthetic password";
    const first = await provisionDevelopmentUser({
      client: lifecycle.client,
      email,
      password: originalPassword,
      passwordHasher: hasher,
      generateIdentifier: generateUuidV7,
    });
    if (first.userId === undefined) {
      throw new Error("The first provisioning result must contain a User ID.");
    }
    const original =
      await lifecycle.client.userPasswordCredential.findUniqueOrThrow({
        where: { userId: first.userId },
      });

    const duplicate = await provisionDevelopmentUser({
      client: lifecycle.client,
      email: email.toUpperCase(),
      password: "replacement synthetic password",
      passwordHasher: hasher,
      generateIdentifier: generateUuidV7,
    });

    expect(duplicate).toEqual({ status: "already-exists", email });
    const users = await lifecycle.client.user.count({
      where: { emailNormalized: email },
    });
    const unchanged =
      await lifecycle.client.userPasswordCredential.findUniqueOrThrow({
        where: { userId: first.userId },
      });
    expect(users).toBe(1);
    expect(unchanged.passwordHash).toBe(original.passwordHash);
  });

  it("applies password policy before persistence", async () => {
    const email = `short-password.${generateUuidV7()}@bcm.local`;
    await expect(
      provisionDevelopmentUser({
        client: lifecycle.client,
        email,
        password: "too short",
        passwordHasher: hasher,
        generateIdentifier: generateUuidV7,
      }),
    ).rejects.toThrow("password policy");
    await expect(
      lifecycle.client.user.count({ where: { emailNormalized: email } }),
    ).resolves.toBe(0);
  });

  it("rolls back the User when credential persistence fails", async () => {
    const email = `rollback.${generateUuidV7()}@bcm.local`;
    const invalidHasher: PasswordHasher = {
      hash: async () => null as unknown as string,
      verify: async () => false,
      isSupportedHash: () => false,
      needsRehash: () => true,
    };

    await expect(
      provisionDevelopmentUser({
        client: lifecycle.client,
        email,
        password: "valid synthetic password",
        passwordHasher: invalidHasher,
        generateIdentifier: generateUuidV7,
      }),
    ).rejects.toThrow();
    await expect(
      lifecycle.client.user.count({ where: { emailNormalized: email } }),
    ).resolves.toBe(0);
  });
});
