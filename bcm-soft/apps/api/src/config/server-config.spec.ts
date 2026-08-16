import { describe, expect, it } from "vitest";

import { loadMigrationDatabaseConfig } from "./database-config.js";
import { loadServerConfig } from "./server-config.js";

const RUNTIME_DATABASE_URL =
  "postgresql://runtime-user:runtime-password@database.internal:5432/bcm_soft";
const MIGRATION_DATABASE_URL =
  "postgresql://migration-user:migration-password@database.internal:5432/bcm_soft";

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
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
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
    });

    expect(migrationConfig).toEqual({
      migrationUrl: MIGRATION_DATABASE_URL,
    });
    expect(Object.isFrozen(migrationConfig)).toBe(true);
  });

  it("rejects a missing direct migration database URL", () => {
    expect(() => loadMigrationDatabaseConfig({})).toThrow(
      "Invalid server configuration: DIRECT_DATABASE_URL is required.",
    );
  });
});
