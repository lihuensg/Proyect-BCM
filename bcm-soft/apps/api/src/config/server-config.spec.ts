import { describe, expect, it } from "vitest";

import { loadMigrationDatabaseConfig } from "./database-config.js";
import { loadServerConfig as loadServerConfigFromEnvironment } from "./server-config.js";

const RUNTIME_DATABASE_URL =
  "postgresql://runtime-user:runtime-password@database.internal:5432/bcm_soft";
const MIGRATION_DATABASE_URL =
  "postgresql://migration-user:migration-password@database.internal:5432/bcm_soft";
const SHADOW_DATABASE_URL =
  "postgresql://migration-user:migration-password@database.internal:5432/bcm_soft_shadow";
const CSRF_HMAC_KEY = Buffer.alloc(32, 1).toString("base64url");
const RATE_LIMIT_HMAC_KEY = Buffer.alloc(32, 2).toString("base64url");
const AUTH0_CLIENT_SECRET = "s".repeat(64);
const SECURITY_ENVIRONMENT = {
  TRUSTED_ORIGINS: "https://app.bcm.test",
  CSRF_HMAC_KEY,
  RATE_LIMIT_HMAC_KEY,
  AUTH0_ISSUER_URL: "https://bcm-test.us.auth0.com/",
  AUTH0_CLIENT_ID: "abcDEF123_-",
  AUTH0_CLIENT_SECRET,
  AUTH0_CALLBACK_URL: "https://api.bcm.test/api/auth/auth0/callback",
  WEB_APP_ORIGIN: "https://app.bcm.test",
  AUTH0_MANAGEMENT_CLIENT_ID: "managementClient",
  AUTH0_MANAGEMENT_CLIENT_SECRET: "m".repeat(64),
} as const;

function loadServerConfig(environment: NodeJS.ProcessEnv) {
  return loadServerConfigFromEnvironment({
    ...SECURITY_ENVIRONMENT,
    ...environment,
  });
}

describe("loadServerConfig", () => {
  it("returns typed immutable configuration for valid server values", () => {
    const config = loadServerConfig({
      NODE_ENV: "production",
      PORT: "3000",
      DATABASE_URL: RUNTIME_DATABASE_URL,
    });

    expect(config).toEqual({
      auth0: {
        issuerUrl: "https://bcm-test.us.auth0.com/",
        clientId: "abcDEF123_-",
        clientSecret: AUTH0_CLIENT_SECRET,
        callbackUrl: "https://api.bcm.test/api/auth/auth0/callback",
        webAppOrigin: "https://app.bcm.test",
        management: {
          clientId: "managementClient",
          clientSecret: "m".repeat(64),
          connection: "Username-Password-Authentication",
        },
      },
      setupToken: null,
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
      security: {
        trustedOrigins: ["https://app.bcm.test"],
        csrfHmacKey: Buffer.alloc(32, 1),
        rateLimitHmacKey: Buffer.alloc(32, 2),
        networkRateLimit: {
          maximumAttempts: 30,
          windowMilliseconds: 600_000,
          blockMilliseconds: 600_000,
        },
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
      auth0: {
        issuerUrl: "https://bcm-test.us.auth0.com/",
        clientId: "abcDEF123_-",
        clientSecret: AUTH0_CLIENT_SECRET,
        callbackUrl: "https://api.bcm.test/api/auth/auth0/callback",
        webAppOrigin: "https://app.bcm.test",
        management: {
          clientId: "managementClient",
          clientSecret: "m".repeat(64),
          connection: "Username-Password-Authentication",
        },
      },
      setupToken: null,
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
      security: {
        trustedOrigins: ["https://app.bcm.test"],
        csrfHmacKey: Buffer.alloc(32, 1),
        rateLimitHmacKey: Buffer.alloc(32, 2),
        networkRateLimit: {
          maximumAttempts: 30,
          windowMilliseconds: 600_000,
          blockMilliseconds: 600_000,
        },
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

  it("fails closed for missing or weak security configuration", () => {
    expect(() =>
      loadServerConfigFromEnvironment({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "production",
        PORT: "3000",
      }),
    ).toThrow("Invalid server configuration: TRUSTED_ORIGINS is required.");
    expect(() =>
      loadServerConfigFromEnvironment({
        ...SECURITY_ENVIRONMENT,
        CSRF_HMAC_KEY: Buffer.alloc(31).toString("base64url"),
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "production",
        PORT: "3000",
      }),
    ).toThrow("Invalid server configuration: CSRF_HMAC_KEY");
  });

  it("accepts only canonical trusted origins and deduplicates exact entries", () => {
    expect(
      loadServerConfig({
        DATABASE_URL: RUNTIME_DATABASE_URL,
        NODE_ENV: "test",
        TRUSTED_ORIGINS:
          "https://app.bcm.test,http://localhost:5173,https://app.bcm.test",
      }).security.trustedOrigins,
    ).toEqual(["https://app.bcm.test", "http://localhost:5173"]);

    for (const trustedOrigins of [
      "https://app.bcm.test/route",
      "https://app.bcm.test?query=1",
      "https://user@app.bcm.test",
      "https://app.bcm.test,",
      "*",
    ]) {
      expect(() =>
        loadServerConfig({
          DATABASE_URL: RUNTIME_DATABASE_URL,
          NODE_ENV: "test",
          TRUSTED_ORIGINS: trustedOrigins,
        }),
      ).toThrow("Invalid server configuration: TRUSTED_ORIGINS");
    }
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

describe("loadServerConfig Auth0 client", () => {
  const base = {
    NODE_ENV: "production",
    PORT: "3000",
    DATABASE_URL: RUNTIME_DATABASE_URL,
  } as const;

  it("canonicalizes the issuer to Auth0's trailing-slash form", () => {
    expect(
      loadServerConfig({
        ...base,
        AUTH0_ISSUER_URL: "https://bcm-test.us.auth0.com",
      }).auth0.issuerUrl,
    ).toBe("https://bcm-test.us.auth0.com/");
  });

  it.each([
    ["AUTH0_ISSUER_URL", "", "AUTH0_ISSUER_URL is required"],
    [
      "AUTH0_ISSUER_URL",
      "not a url",
      "AUTH0_ISSUER_URL must be an absolute URL",
    ],
    [
      "AUTH0_ISSUER_URL",
      "http://bcm-test.us.auth0.com/",
      "AUTH0_ISSUER_URL must use HTTPS",
    ],
    [
      "AUTH0_ISSUER_URL",
      "http://localhost:4000/",
      "AUTH0_ISSUER_URL must use HTTPS",
    ],
    [
      "AUTH0_ISSUER_URL",
      "https://bcm-test.us.auth0.com/tenant/",
      "AUTH0_ISSUER_URL must not contain a path",
    ],
    [
      "AUTH0_ISSUER_URL",
      "https://bcm-test.us.auth0.com/?x=1",
      "AUTH0_ISSUER_URL must not contain credentials, a query, or a fragment",
    ],
    ["AUTH0_CLIENT_ID", "bad id", "AUTH0_CLIENT_ID has an invalid format"],
    [
      "AUTH0_CLIENT_SECRET",
      "short",
      "AUTH0_CLIENT_SECRET must be at least 32 characters",
    ],
    [
      "AUTH0_CLIENT_SECRET",
      `${"s".repeat(40)} x`,
      "AUTH0_CLIENT_SECRET must be at least 32 characters",
    ],
    [
      "AUTH0_CALLBACK_URL",
      "https://api.bcm.test/callback",
      "AUTH0_CALLBACK_URL must use the path /api/auth/auth0/callback",
    ],
    [
      "WEB_APP_ORIGIN",
      "https://evil.test",
      "WEB_APP_ORIGIN must be one of TRUSTED_ORIGINS",
    ],
    [
      "AUTH0_MANAGEMENT_CLIENT_ID",
      "abcDEF123_-",
      "AUTH0_MANAGEMENT_CLIENT_ID must be a separate machine-to-machine application",
    ],
    [
      "AUTH0_MANAGEMENT_CLIENT_SECRET",
      "short",
      "AUTH0_MANAGEMENT_CLIENT_SECRET must be at least 32 characters",
    ],
    [
      "AUTH0_DATABASE_CONNECTION",
      "bad connection",
      "AUTH0_DATABASE_CONNECTION has an invalid format",
    ],
  ])("rejects %s=%j", (variableName, value, message) => {
    expect(() => loadServerConfig({ ...base, [variableName]: value })).toThrow(
      `Invalid server configuration: ${message}`,
    );
  });

  it("allows loopback HTTP only outside production", () => {
    const config = loadServerConfig({
      ...base,
      NODE_ENV: "development",
      TRUSTED_ORIGINS: "http://localhost:5173",
      WEB_APP_ORIGIN: "http://localhost:5173",
      AUTH0_ISSUER_URL: "http://127.0.0.1:4000/",
      AUTH0_CALLBACK_URL: "http://localhost:3000/api/auth/auth0/callback",
    });

    expect(config.auth0.issuerUrl).toBe("http://127.0.0.1:4000/");
    expect(config.auth0.callbackUrl).toBe(
      "http://localhost:3000/api/auth/auth0/callback",
    );
  });
});

describe("loadServerConfig setup token", () => {
  const base = {
    NODE_ENV: "production",
    PORT: "3000",
    DATABASE_URL: RUNTIME_DATABASE_URL,
  } as const;

  it("is optional and disables setup when absent", () => {
    expect(loadServerConfig(base).setupToken).toBeNull();
    expect(
      loadServerConfig({ ...base, SETUP_TOKEN: "t".repeat(32) }).setupToken,
    ).toBe("t".repeat(32));
  });

  it("rejects a short or whitespace token", () => {
    for (const value of ["short", `${"t".repeat(32)} x`]) {
      expect(() => loadServerConfig({ ...base, SETUP_TOKEN: value })).toThrow(
        "Invalid server configuration: SETUP_TOKEN must be at least 32 characters",
      );
    }
  });
});
