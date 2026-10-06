import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Shared by the local development launchers; never used by tests or CI.
export const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const localDatabaseEnvironmentFile = fileURLToPath(
  new URL("../../../infrastructure/postgres/.env", import.meta.url),
);

// Optional, Git-ignored file with the developer's own Auth0 client values.
const localApiEnvironmentFile = fileURLToPath(
  new URL("../.env", import.meta.url),
);

function readEnvironmentFile(
  path: string,
  description: string,
): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`${description} contains an invalid entry.`);
    }
    entries.set(line.slice(0, separator), line.slice(separator + 1));
  }

  return entries;
}

export function readLocalDatabaseEnvironment(): ReadonlyMap<string, string> {
  return readEnvironmentFile(
    localDatabaseEnvironmentFile,
    "Local PostgreSQL environment",
  );
}

/** Values from apps/api/.env; an exported shell variable takes precedence. */
export function readLocalAuth0Environment(): NodeJS.ProcessEnv {
  const file = existsSync(localApiEnvironmentFile)
    ? readEnvironmentFile(localApiEnvironmentFile, "Local API environment")
    : new Map<string, string>();
  const value = (name: string): string | undefined =>
    process.env[name] ?? file.get(name);
  return {
    AUTH0_ISSUER_URL: value("AUTH0_ISSUER_URL"),
    AUTH0_CLIENT_ID: value("AUTH0_CLIENT_ID"),
    AUTH0_CLIENT_SECRET: value("AUTH0_CLIENT_SECRET"),
    AUTH0_MANAGEMENT_CLIENT_ID: value("AUTH0_MANAGEMENT_CLIENT_ID"),
    AUTH0_MANAGEMENT_CLIENT_SECRET: value("AUTH0_MANAGEMENT_CLIENT_SECRET"),
    AUTH0_DATABASE_CONNECTION: value("AUTH0_DATABASE_CONNECTION"),
    SETUP_TOKEN: value("SETUP_TOKEN"),
  };
}

export function requiredValue(
  environment: ReadonlyMap<string, string>,
  variableName: string,
): string {
  const value = environment.get(variableName);
  if (value === undefined || value.length === 0) {
    throw new Error(`Local PostgreSQL environment requires ${variableName}.`);
  }
  return value;
}

export function databaseUrl(
  input: Readonly<{
    applicationName: string;
    database: string;
    password: string;
    port: string;
    role: string;
  }>,
): string {
  if (!/^\d+$/u.test(input.port)) {
    throw new Error("Local PostgreSQL port must be an integer.");
  }
  const port = Number(input.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Local PostgreSQL port is outside the valid range.");
  }

  const url = new URL("postgresql://127.0.0.1");
  url.username = input.role;
  url.password = input.password;
  url.port = input.port;
  url.pathname = input.database;
  url.searchParams.set("application_name", input.applicationName);
  return url.href;
}

export function run(
  command: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, arguments_, {
    cwd: apiDirectory,
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${String(result.status)}.`);
  }
}

export function runPnpm(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): void {
  const pnpmExecutable = process.env.npm_execpath;
  if (pnpmExecutable === undefined || pnpmExecutable.length === 0) {
    throw new Error("pnpm execution path is unavailable.");
  }
  run(process.execPath, [pnpmExecutable, ...arguments_], environment);
}

export function assertDevelopmentLauncher(description: string): void {
  if (
    process.env.NODE_ENV !== undefined &&
    process.env.NODE_ENV !== "development"
  ) {
    throw new Error(`${description} accepts only NODE_ENV=development.`);
  }
}

/** Runtime and migration URLs for the local Compose PostgreSQL. */
export function readLocalDatabaseUrls(): Readonly<{
  runtimeUrl: string;
  migrationUrl: string;
}> {
  const environment = readLocalDatabaseEnvironment();
  const port = requiredValue(environment, "BCM_POSTGRES_PORT");
  const database = requiredValue(environment, "BCM_POSTGRES_DATABASE");
  return {
    runtimeUrl: databaseUrl({
      applicationName: "bcm-soft-local-api",
      database,
      password: requiredValue(environment, "BCM_RUNTIME_PASSWORD"),
      port,
      role: requiredValue(environment, "BCM_RUNTIME_ROLE"),
    }),
    migrationUrl: databaseUrl({
      applicationName: "bcm-soft-local-migration",
      database,
      password: requiredValue(environment, "BCM_MIGRATION_PASSWORD"),
      port,
      role: requiredValue(environment, "BCM_MIGRATION_ROLE"),
    }),
  };
}
