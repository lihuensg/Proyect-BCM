import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadServerConfig } from "../../../src/config/server-config.js";
import { PersistentLoginRateLimiter } from "../../../src/identity/application/persistent-login-rate-limiter.js";
import { NodeRateLimitFingerprint } from "../../../src/identity/infrastructure/node-rate-limit-fingerprint.js";
import { PrismaLoginRateLimitStore } from "../../../src/identity/infrastructure/prisma-login-rate-limit-store.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";

describe("persistent login rate limiting with PostgreSQL", () => {
  const config = loadServerConfig(process.env);
  const lifecycle = new PrismaClientLifecycle(config.database.runtimeUrl, {
    max: 12,
  });
  let now = new Date("2026-08-18T12:00:00.000Z");
  const limiter = new PersistentLoginRateLimiter(
    new PrismaLoginRateLimitStore(lifecycle.client),
    new NodeRateLimitFingerprint(config.security.rateLimitHmacKey),
    { now: () => now },
    config.security.loginRateLimits,
  );

  beforeAll(async () => {
    await lifecycle.connect();
  });

  beforeEach(async () => {
    await lifecycle.client.identityRateLimitWindow.deleteMany();
    now = new Date("2026-08-18T12:00:00.000Z");
  });

  afterAll(async () => {
    await lifecycle.client.identityRateLimitWindow.deleteMany();
    await lifecycle.disconnect();
  });

  it("atomically counts concurrent attempts and blocks only after the exact threshold", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.consume({
          normalizedEmail: "known@example.test",
          clientIp: "127.0.0.25",
        }),
      ),
    );

    expect(attempts.filter((result) => !result.allowed)).toHaveLength(1);
    const persisted = await lifecycle.client.identityRateLimitWindow.findMany({
      orderBy: { dimension: "asc" },
    });
    expect(persisted).toHaveLength(3);
    expect(persisted.map((window) => window.attemptCount)).toEqual([6, 6, 6]);
    expect(
      persisted.find((window) => window.dimension === "IdentityNetwork")
        ?.blockedUntil,
    ).toEqual(new Date(now.getTime() + 600_000));

    await expect(
      limiter.consume({
        normalizedEmail: "known@example.test",
        clientIp: "127.0.0.25",
      }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 600 });

    now = new Date(now.getTime() + 30_000);
    await expect(
      limiter.consume({
        normalizedEmail: "known@example.test",
        clientIp: "127.0.0.25",
      }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 570 });
    expect(
      (
        await lifecycle.client.identityRateLimitWindow.findFirstOrThrow({
          where: { dimension: "IdentityNetwork" },
        })
      ).blockedUntil,
    ).toEqual(new Date("2026-08-18T12:10:00.000Z"));

    const secondLifecycle = new PrismaClientLifecycle(
      config.database.runtimeUrl,
      { max: 2 },
    );
    await secondLifecycle.connect();
    try {
      const secondInstance = new PersistentLoginRateLimiter(
        new PrismaLoginRateLimitStore(secondLifecycle.client),
        new NodeRateLimitFingerprint(config.security.rateLimitHmacKey),
        { now: () => now },
        config.security.loginRateLimits,
      );
      await expect(
        secondInstance.consume({
          normalizedEmail: "known@example.test",
          clientIp: "127.0.0.25",
        }),
      ).resolves.toEqual({ allowed: false, retryAfterSeconds: 570 });
    } finally {
      await secondLifecycle.disconnect();
    }

    now = new Date("2026-08-18T12:10:01.000Z");
    await expect(
      limiter.consume({
        normalizedEmail: "known@example.test",
        clientIp: "127.0.0.25",
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it("enforces Network and Identity thresholds independently", async () => {
    const networkResults = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      networkResults.push(
        await limiter.consume({
          normalizedEmail: `network-${attempt}@example.test`,
          clientIp: "127.0.0.30",
        }),
      );
    }
    expect(networkResults[29]).toEqual({ allowed: true });
    expect(networkResults[30]).toEqual({
      allowed: false,
      retryAfterSeconds: 600,
    });

    await lifecycle.client.identityRateLimitWindow.deleteMany();
    const identityResults = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      identityResults.push(
        await limiter.consume({
          normalizedEmail: "identity-threshold@example.test",
          clientIp: `127.0.1.${attempt + 1}`,
        }),
      );
    }
    expect(identityResults[9]).toEqual({ allowed: true });
    expect(identityResults[10]).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
  });

  it("applies indistinguishable persisted policy to an unknown identity", async () => {
    now = new Date("2026-08-18T13:00:00.000Z");
    const results = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      results.push(
        await limiter.consume({
          normalizedEmail: "unknown@example.test",
          clientIp: "127.0.0.26",
        }),
      );
    }
    expect(results.at(-1)).toEqual({ allowed: false, retryAfterSeconds: 600 });
  });
});
