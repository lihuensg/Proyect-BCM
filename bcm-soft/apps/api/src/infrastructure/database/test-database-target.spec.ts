import { describe, expect, it, vi } from "vitest";

import {
  assertSafeTestDatabaseTarget,
  cleanupTestDatabase,
} from "./test-database-target.js";

const SAFE_TEST_URL =
  "postgresql://bcm_test_abc123:123456789012345678901234@127.0.0.1:55432/bcm_soft_test_abc123?application_name=bcm-soft-test";
const SAFE_PROJECT = "bcm-db001-test-abcdef123456";

describe("test database destructive guards", () => {
  it("accepts an explicitly identified loopback test target", () => {
    expect(assertSafeTestDatabaseTarget(SAFE_TEST_URL, "test").hostname).toBe(
      "127.0.0.1",
    );
  });

  it("rejects cleanup outside the test runtime", async () => {
    const cleanup = vi.fn<() => Promise<void>>();

    await expect(
      cleanupTestDatabase(SAFE_TEST_URL, "production", SAFE_PROJECT, cleanup),
    ).rejects.toThrow("Test database cleanup requires NODE_ENV=test.");
    expect(cleanup).not.toHaveBeenCalled();
  });

  it.each([
    "postgresql://bcm_test_user:123456789012345678901234@database.example.com:5432/bcm_soft_test_remote?application_name=bcm-soft-test",
    "postgresql://postgres:123456789012345678901234@127.0.0.1:5432/postgres?application_name=bcm-soft-test",
    "postgresql://bcm_test_user:123456789012345678901234@127.0.0.1:5432/bcm_soft_test_safe",
  ])("rejects ambiguous or non-local cleanup target", async (target) => {
    const cleanup = vi.fn<() => Promise<void>>();

    await expect(
      cleanupTestDatabase(target, "test", SAFE_PROJECT, cleanup),
    ).rejects.toThrow("Test database target is not an allowed local URL.");
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("rejects cleanup for an unrelated compose project", async () => {
    const cleanup = vi.fn<() => Promise<void>>();

    await expect(
      cleanupTestDatabase(SAFE_TEST_URL, "test", "bcm-production", cleanup),
    ).rejects.toThrow("Test database cleanup project is not allowed.");
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("runs cleanup only after every target guard passes", async () => {
    const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue();

    await cleanupTestDatabase(SAFE_TEST_URL, "test", SAFE_PROJECT, cleanup);

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
