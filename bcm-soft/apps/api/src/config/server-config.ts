import {
  loadRuntimeDatabaseConfig,
  type RuntimeDatabaseConfig,
} from "./database-config.js";

type RuntimeEnvironment = "development" | "test" | "production";

export type SessionConfig = Readonly<{
  idleTimeoutMilliseconds: number;
  absoluteLifetimeMilliseconds: number;
  touchIntervalMilliseconds: number;
}>;

export type SessionCookieConfig = Readonly<{
  name: "__Host-bcm_session" | "bcm_session";
  httpOnly: true;
  secure: boolean;
  sameSite: "Lax";
  path: "/";
}>;

export type ServerConfig = Readonly<{
  database: RuntimeDatabaseConfig;
  environment: RuntimeEnvironment;
  port: number;
  session: SessionConfig;
  sessionCookie: SessionCookieConfig;
  security: SecurityConfig;
}>;

export type RateLimitRuleConfig = Readonly<{
  maximumAttempts: number;
  windowMilliseconds: number;
  blockMilliseconds: number;
}>;

export type SecurityConfig = Readonly<{
  trustedOrigins: readonly string[];
  csrfHmacKey: Buffer;
  rateLimitHmacKey: Buffer;
  loginRateLimits: Readonly<{
    network: RateLimitRuleConfig;
    identity: RateLimitRuleConfig;
    identityNetwork: RateLimitRuleConfig;
  }>;
}>;

const MINUTE_MILLISECONDS = 60_000;
const HOUR_MILLISECONDS = 60 * MINUTE_MILLISECONDS;

function configurationError(variableName: string, reason: string): never {
  throw new Error(`Invalid server configuration: ${variableName} ${reason}.`);
}

function readRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
): RuntimeEnvironment {
  const value = environment.NODE_ENV;

  if (value === undefined || value.length === 0) {
    return configurationError("NODE_ENV", "is required");
  }

  switch (value) {
    case "development":
    case "test":
    case "production":
      return value;
    default:
      return configurationError("NODE_ENV", "is not supported");
  }
}

function readPort(
  environment: NodeJS.ProcessEnv,
  runtimeEnvironment: RuntimeEnvironment,
): number {
  const value = environment.PORT;

  if (value === undefined || value.length === 0) {
    if (runtimeEnvironment === "test") {
      return 0;
    }

    return configurationError("PORT", "is required");
  }

  if (!/^\d+$/.test(value)) {
    return configurationError("PORT", "must be an integer");
  }

  const port = Number(value);
  const minimumPort = runtimeEnvironment === "test" ? 0 : 1;

  if (!Number.isSafeInteger(port) || port < minimumPort || port > 65_535) {
    return configurationError(
      "PORT",
      `must be between ${minimumPort} and 65535`,
    );
  }

  return port;
}

function readBoundedInteger(
  environment: NodeJS.ProcessEnv,
  variableName:
    | "SESSION_IDLE_TIMEOUT_MINUTES"
    | "SESSION_ABSOLUTE_LIFETIME_HOURS"
    | "SESSION_TOUCH_INTERVAL_MINUTES",
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[variableName];
  if (value === undefined || value.length === 0) return defaultValue;

  if (!/^\d+$/u.test(value)) {
    return configurationError(variableName, "must be an integer");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return configurationError(
      variableName,
      `must be between ${minimum} and ${maximum}`,
    );
  }

  return parsed;
}

function loadSessionConfig(environment: NodeJS.ProcessEnv): SessionConfig {
  const idleTimeoutMinutes = readBoundedInteger(
    environment,
    "SESSION_IDLE_TIMEOUT_MINUTES",
    30,
    1,
    1_440,
  );
  const absoluteLifetimeHours = readBoundedInteger(
    environment,
    "SESSION_ABSOLUTE_LIFETIME_HOURS",
    12,
    1,
    168,
  );
  const touchIntervalMinutes = readBoundedInteger(
    environment,
    "SESSION_TOUCH_INTERVAL_MINUTES",
    5,
    1,
    30,
  );
  const idleTimeoutMilliseconds = idleTimeoutMinutes * MINUTE_MILLISECONDS;
  const absoluteLifetimeMilliseconds =
    absoluteLifetimeHours * HOUR_MILLISECONDS;
  const touchIntervalMilliseconds = touchIntervalMinutes * MINUTE_MILLISECONDS;

  if (touchIntervalMilliseconds >= idleTimeoutMilliseconds) {
    return configurationError(
      "SESSION_TOUCH_INTERVAL_MINUTES",
      "must be less than SESSION_IDLE_TIMEOUT_MINUTES",
    );
  }
  if (idleTimeoutMilliseconds > absoluteLifetimeMilliseconds) {
    return configurationError(
      "SESSION_IDLE_TIMEOUT_MINUTES",
      "must not exceed SESSION_ABSOLUTE_LIFETIME_HOURS",
    );
  }

  return Object.freeze({
    idleTimeoutMilliseconds,
    absoluteLifetimeMilliseconds,
    touchIntervalMilliseconds,
  });
}

function loadSessionCookieConfig(
  runtimeEnvironment: RuntimeEnvironment,
): SessionCookieConfig {
  const production = runtimeEnvironment === "production";

  return Object.freeze({
    name: production ? "__Host-bcm_session" : "bcm_session",
    httpOnly: true,
    secure: production,
    sameSite: "Lax",
    path: "/",
  });
}

function readHmacKey(
  environment: NodeJS.ProcessEnv,
  variableName: "CSRF_HMAC_KEY" | "RATE_LIMIT_HMAC_KEY",
): Buffer {
  const value = environment[variableName];
  if (value === undefined || value.length === 0) {
    return configurationError(variableName, "is required");
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return configurationError(variableName, "must be base64url encoded");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < 32 || decoded.toString("base64url") !== value) {
    return configurationError(
      variableName,
      "must decode to at least 32 bytes using canonical base64url",
    );
  }
  return decoded;
}

function readTrustedOrigins(environment: NodeJS.ProcessEnv): readonly string[] {
  const value = environment.TRUSTED_ORIGINS;
  if (value === undefined || value.length === 0) {
    return configurationError("TRUSTED_ORIGINS", "is required");
  }

  const origins = value.split(",").map((entry) => entry.trim());
  if (origins.some((origin) => origin.length === 0)) {
    return configurationError("TRUSTED_ORIGINS", "contains an empty origin");
  }

  const canonical = origins.map((origin) => {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return configurationError("TRUSTED_ORIGINS", "contains an invalid URL");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== origin ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return configurationError(
        "TRUSTED_ORIGINS",
        "must contain canonical HTTP(S) origins only",
      );
    }
    return url.origin;
  });

  return Object.freeze([...new Set(canonical)]);
}

function rateRule(
  maximumAttempts: number,
  windowMinutes: number,
  blockMinutes: number,
): RateLimitRuleConfig {
  return Object.freeze({
    maximumAttempts,
    windowMilliseconds: windowMinutes * MINUTE_MILLISECONDS,
    blockMilliseconds: blockMinutes * MINUTE_MILLISECONDS,
  });
}

function loadSecurityConfig(environment: NodeJS.ProcessEnv): SecurityConfig {
  return Object.freeze({
    trustedOrigins: readTrustedOrigins(environment),
    csrfHmacKey: readHmacKey(environment, "CSRF_HMAC_KEY"),
    rateLimitHmacKey: readHmacKey(environment, "RATE_LIMIT_HMAC_KEY"),
    loginRateLimits: Object.freeze({
      network: rateRule(30, 10, 10),
      identity: rateRule(10, 15, 15),
      identityNetwork: rateRule(5, 10, 10),
    }),
  });
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const runtimeEnvironment = readRuntimeEnvironment(environment);

  return Object.freeze({
    database: loadRuntimeDatabaseConfig(environment),
    environment: runtimeEnvironment,
    port: readPort(environment, runtimeEnvironment),
    session: loadSessionConfig(environment),
    sessionCookie: loadSessionCookieConfig(runtimeEnvironment),
    security: loadSecurityConfig(environment),
  });
}
