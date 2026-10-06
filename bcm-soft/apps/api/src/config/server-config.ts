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

/** OIDC Authorization Code client for the Auth0 tenant (ADR-008). */
export type Auth0Config = Readonly<{
  /** Canonical issuer with a trailing slash, as Auth0 emits `iss`. */
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  /** Trusted Web origin the browser returns to after login or logout. */
  webAppOrigin: string;
  /** Machine-to-machine client limited to `create:users` and `read:users`. */
  management: Readonly<{
    clientId: string;
    clientSecret: string;
    /** Database connection where BCM creates and manages accounts. */
    connection: string;
  }>;
}>;

export type ServerConfig = Readonly<{
  auth0: Auth0Config;
  /**
   * Secret the one-time initial setup must present. Null disables setup: an
   * unconfigured instance must not be claimable by whoever reaches it first.
   */
  setupToken: string | null;
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
  /** Per-client-IP limit for the identity endpoints the API still serves. */
  networkRateLimit: RateLimitRuleConfig;
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
    networkRateLimit: rateRule(30, 10, 10),
  });
}

type Auth0VariableName =
  | "AUTH0_ISSUER_URL"
  | "AUTH0_CLIENT_ID"
  | "AUTH0_CLIENT_SECRET"
  | "AUTH0_MANAGEMENT_CLIENT_ID"
  | "AUTH0_MANAGEMENT_CLIENT_SECRET"
  | "AUTH0_DATABASE_CONNECTION"
  | "AUTH0_CALLBACK_URL"
  | "WEB_APP_ORIGIN";

const AUTH0_CALLBACK_PATH = "/api/auth/auth0/callback";
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

function readRequired(
  environment: NodeJS.ProcessEnv,
  variableName: Auth0VariableName,
): string {
  const value = environment[variableName];
  if (value === undefined || value.length === 0) {
    return configurationError(variableName, "is required");
  }
  return value;
}

/**
 * Plain HTTP is accepted only for loopback hosts outside production, so local
 * development and the test OIDC provider work while deployments require TLS.
 */
function readHttpUrl(
  environment: NodeJS.ProcessEnv,
  variableName: Auth0VariableName,
  runtimeEnvironment: RuntimeEnvironment,
): URL {
  const value = readRequired(environment, variableName);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return configurationError(variableName, "must be an absolute URL");
  }
  const insecureAllowed =
    runtimeEnvironment !== "production" && LOOPBACK_HOSTS.has(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && insecureAllowed)
  ) {
    return configurationError(variableName, "must use HTTPS");
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return configurationError(
      variableName,
      "must not contain credentials, a query, or a fragment",
    );
  }
  return url;
}

function readClientId(
  environment: NodeJS.ProcessEnv,
  variableName: "AUTH0_CLIENT_ID" | "AUTH0_MANAGEMENT_CLIENT_ID",
): string {
  const value = readRequired(environment, variableName);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    return configurationError(variableName, "has an invalid format");
  }
  return value;
}

function readClientSecret(
  environment: NodeJS.ProcessEnv,
  variableName: "AUTH0_CLIENT_SECRET" | "AUTH0_MANAGEMENT_CLIENT_SECRET",
): string {
  const value = readRequired(environment, variableName);
  if (value.length < 32 || /\s/u.test(value)) {
    return configurationError(
      variableName,
      "must be at least 32 characters without whitespace",
    );
  }
  return value;
}

function loadAuth0Config(
  environment: NodeJS.ProcessEnv,
  runtimeEnvironment: RuntimeEnvironment,
  trustedOrigins: readonly string[],
): Auth0Config {
  const issuer = readHttpUrl(
    environment,
    "AUTH0_ISSUER_URL",
    runtimeEnvironment,
  );
  if (issuer.pathname !== "/") {
    return configurationError("AUTH0_ISSUER_URL", "must not contain a path");
  }

  const clientId = readClientId(environment, "AUTH0_CLIENT_ID");
  const clientSecret = readClientSecret(environment, "AUTH0_CLIENT_SECRET");
  const managementClientId = readClientId(
    environment,
    "AUTH0_MANAGEMENT_CLIENT_ID",
  );
  if (managementClientId === clientId) {
    return configurationError(
      "AUTH0_MANAGEMENT_CLIENT_ID",
      "must be a separate machine-to-machine application",
    );
  }
  const managementClientSecret = readClientSecret(
    environment,
    "AUTH0_MANAGEMENT_CLIENT_SECRET",
  );
  const connection =
    environment.AUTH0_DATABASE_CONNECTION ?? "Username-Password-Authentication";
  if (!/^[A-Za-z0-9-]{1,128}$/u.test(connection)) {
    return configurationError(
      "AUTH0_DATABASE_CONNECTION",
      "has an invalid format",
    );
  }

  const callback = readHttpUrl(
    environment,
    "AUTH0_CALLBACK_URL",
    runtimeEnvironment,
  );
  if (callback.pathname !== AUTH0_CALLBACK_PATH) {
    return configurationError(
      "AUTH0_CALLBACK_URL",
      `must use the path ${AUTH0_CALLBACK_PATH}`,
    );
  }

  const webAppOrigin = readRequired(environment, "WEB_APP_ORIGIN");
  if (!trustedOrigins.includes(webAppOrigin)) {
    return configurationError(
      "WEB_APP_ORIGIN",
      "must be one of TRUSTED_ORIGINS",
    );
  }

  return Object.freeze({
    issuerUrl: `${issuer.origin}/`,
    clientId,
    clientSecret,
    callbackUrl: callback.href,
    webAppOrigin,
    management: Object.freeze({
      clientId: managementClientId,
      clientSecret: managementClientSecret,
      connection,
    }),
  });
}

function readSetupToken(environment: NodeJS.ProcessEnv): string | null {
  const value = environment.SETUP_TOKEN;
  if (value === undefined || value.length === 0) return null;
  if (value.length < 32 || /\s/u.test(value)) {
    return configurationError(
      "SETUP_TOKEN",
      "must be at least 32 characters without whitespace",
    );
  }
  return value;
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const runtimeEnvironment = readRuntimeEnvironment(environment);
  const security = loadSecurityConfig(environment);

  return Object.freeze({
    auth0: loadAuth0Config(
      environment,
      runtimeEnvironment,
      security.trustedOrigins,
    ),
    setupToken: readSetupToken(environment),
    database: loadRuntimeDatabaseConfig(environment),
    environment: runtimeEnvironment,
    port: readPort(environment, runtimeEnvironment),
    session: loadSessionConfig(environment),
    sessionCookie: loadSessionCookieConfig(runtimeEnvironment),
    security,
  });
}
