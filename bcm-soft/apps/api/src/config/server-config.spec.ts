import { describe, expect, it } from "vitest";

import { loadMigrationDatabaseConfig } from "./database-config.js";
import { loadServerConfig } from "./server-config.js";

const RUNTIME_DATABASE_URL =
  "postgresql://runtime-user:runtime-password@database.internal:5432/bcm_soft";
const MIGRATION_DATABASE_URL =
  "postgresql://migration-user:migration-password@database.internal:5432/bcm_soft";
const SHADOW_DATABASE_URL =
  "postgresql://migration-user:migration-password@database.internal:5432/bcm_soft_shadow";

describe("loadServerConfig", () => {
  it("returns typed immutable configuration for valid server values", () => {
    const config = loadServerConfig({
      NODE_ENV: "production",
      PORT: "3000",
      DATABASE_URL: RUNTIME_DATABASE_URL,
    });

    expect(config).toEqual({
      database: { runtimeUrl: RUNTIME_DATABASE_URL },
      environment: "production",
      port: 3000,
      session: {
        idleTimeoutMilliseconds: 1_800_000,
        absoluteLifetimeMilliseconds: 43_200_000,
        touchIntervalMilliseconds: 300_000,
      },
      sessionCookie: {
        name: "__Host-bcm_session",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(Object.isFrozen(config.session)).toBe(true);
    expect(Object.isFrozen(config.sessionCookie)).toBe(true);
  });

  it("rejects a missing required runtime environment", () => {
    expect(() =>
      loadServerConfig({ DATABASE_URL: RUNTIME_DATABASE_URL, PORT: "3000" }),
    ).toThrow("Invalid server configuration: NODE_ENV is required.");
  });

  it("rejects an invalid port without exposing its value", () => {
    const invalidValue = "do-not-print-this-value";

    expect(() =>
      loadServerConfig({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "production",
        PORT: invalidValue,
      }),
    ).toThrow("Invalid server configuration: PORT must be an integer.");

    try {
      loadServerConfig({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "production",
        PORT: invalidValue,
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);

      if (!(error instanceof Error)) {
        throw error;
      }

      expect(error.message).not.toContain(invalidValue);
    }
  });

  it("uses an ephemeral port only when running tests", () => {
    expect(
      loadServerConfig({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "test",
      }),
    ).toEqual({
      database: { runtimeUrl: RUNTIME_DATABASE_URL },
      environment: "test",
      port: 0,
      session: {
        idleTimeoutMilliseconds: 1_800_000,
        absoluteLifetimeMilliseconds: 43_200_000,
        touchIntervalMilliseconds: 300_000,
      },
      sessionCookie: {
        name: "bcm_session",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
        path: "/",
      },
    });

    expect(() =>
      loadServerConfig({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "production",
      }),
    ).toThrow("Invalid server configuration: PORT is required.");
  });

  it("rejects a missing runtime database URL", () => {
    expect(() =>
      loadServerConfig({ NODE_ENV: "production", PORT: "3000" }),
    ).toThrow("Invalid server configuration: DATABASE_URL is required.");
  });

  it("rejects an invalid database URL without exposing credentials", () => {
    const secret = "do-not-print-database-password";
    const invalidUrl = `https://runtime-user:${secret}@database.internal/bcm_soft`;

    expect(() =>
      loadServerConfig({
        DATABASE_URL: invalidUrl,
        NODE_ENV: "production",
        PORT: "3000",
      }),
    ).toThrow(
      "Invalid server configuration: DATABASE_URL must be a PostgreSQL URL.",
    );

    try {
      loadServerConfig({
        DATABASE_URL: invalidUrl,
        NODE_ENV: "production",
        PORT: "3000",
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);

      if (!(error instanceof Error)) {
        throw error;
      }

      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain("database.internal");
      expect(error.message).not.toContain(invalidUrl);
    }
  });

  it("keeps migration credentials separate from runtime configuration", () => {
    const migrationConfig = loadMigrationDatabaseConfig({
      DIRECT_DATABASE_URL: MIGRATION_DATABASE_URL,
      SHADOW_DATABASE_URL,
    });

    expect(migrationConfig).toEqual({
      migrationUrl: MIGRATION_DATABASE_URL,
      shadowDatabaseUrl: SHADOW_DATABASE_URL,
    });
    expect(Object.isFrozen(migrationConfig)).toBe(true);
  });

  it("keeps the shadow database optional for deploy-only environments", () => {
    expect(
      loadMigrationDatabaseConfig({
        DIRECT_DATABASE_URL: MIGRATION_DATABASE_URL,
      }),
    ).toEqual({ migrationUrl: MIGRATION_DATABASE_URL });
  });

  it("rejects a missing direct migration database URL", () => {
    expect(() => loadMigrationDatabaseConfig({})).toThrow(
      "Invalid server configuration: DIRECT_DATABASE_URL is required.",
    );
  });

  it("accepts bounded session policy overrides", () => {
    const config = loadServerConfig({
      DATABASE_URL: RUNTIME_DATABASE_URL,
      NODE_ENV: "test",
      SESSION_IDLE_TIMEOUT_MINUTES: "60",
      SESSION_ABSOLUTE_LIFETIME_HOURS: "24",
      SESSION_TOUCH_INTERVAL_MINUTES: "10",
    });

    expect(config.session).toEqual({
      idleTimeoutMilliseconds: 3_600_000,
      absoluteLifetimeMilliseconds: 86_400_000,
      touchIntervalMilliseconds: 600_000,
    });
    expect(config.sessionCookie.secure).toBe(false);
  });

  it.each([
    ["SESSION_IDLE_TIMEOUT_MINUTES", "0"],
    ["SESSION_IDLE_TIMEOUT_MINUTES", "1441"],
    ["SESSION_ABSOLUTE_LIFETIME_HOURS", "0"],
    ["SESSION_ABSOLUTE_LIFETIME_HOURS", "169"],
    ["SESSION_TOUCH_INTERVAL_MINUTES", "0"],
    ["SESSION_TOUCH_INTERVAL_MINUTES", "31"],
    ["SESSION_TOUCH_INTERVAL_MINUTES", "NaN"],
    ["SESSION_TOUCH_INTERVAL_MINUTES", "-1"],
  ])("rejects an invalid %s value", (variableName, value) => {
    expect(() =>
      loadServerConfig({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "test",
        [variableName]: value,
      }),
    ).toThrow(`Invalid server configuration: ${variableName}`);
  });

  it("requires touch to be shorter than idle and idle not to exceed absolute", () => {
    expect(() =>
      loadServerConfig({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "test",
        SESSION_IDLE_TIMEOUT_MINUTES: "5",
        SESSION_TOUCH_INTERVAL_MINUTES: "5",
      }),
    ).toThrow(
      "Invalid server configuration: SESSION_TOUCH_INTERVAL_MINUTES must be less than SESSION_IDLE_TIMEOUT_MINUTES.",
    );

    expect(() =>
      loadServerConfig({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "test",
        SESSION_IDLE_TIMEOUT_MINUTES: "121",
        SESSION_ABSOLUTE_LIFETIME_HOURS: "2",
      }),
    ).toThrow(
      "Invalid server configuration: SESSION_IDLE_TIMEOUT_MINUTES must not exceed SESSION_ABSOLUTE_LIFETIME_HOURS.",
    );
  });
});
