import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const localDatabaseEnvironmentFile = fileURLToPath(
  new URL("../../../infrastructure/postgres/.env", import.meta.url),
);

function readLocalDatabaseEnvironment(): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();

  for (const rawLine of readFileSync(
    localDatabaseEnvironmentFile,
    "utf8",
  ).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(
        "Local PostgreSQL environment contains an invalid entry.",
      );
    }
    entries.set(line.slice(0, separator), line.slice(separator + 1));
  }

  return entries;
}

function requiredValue(
  environment: ReadonlyMap<string, string>,
  variableName: string,
): string {
  const value = environment.get(variableName);
  if (value === undefined || value.length === 0) {
    throw new Error(`Local PostgreSQL environment requires ${variableName}.`);
  }
  return value;
}

function databaseUrl(
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

function run(
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

function runPnpm(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): void {
  const pnpmExecutable = process.env.npm_execpath;
  if (pnpmExecutable === undefined || pnpmExecutable.length === 0) {
    throw new Error("pnpm execution path is unavailable.");
  }
  run(process.execPath, [pnpmExecutable, ...arguments_], environment);
}

if (
  process.env.NODE_ENV !== undefined &&
  process.env.NODE_ENV !== "development"
) {
  throw new Error("The local API launcher accepts only NODE_ENV=development.");
}

const localDatabaseEnvironment = readLocalDatabaseEnvironment();
const port = requiredValue(localDatabaseEnvironment, "BCM_POSTGRES_PORT");
const database = requiredValue(
  localDatabaseEnvironment,
  "BCM_POSTGRES_DATABASE",
);
const runtimeUrl = databaseUrl({
  applicationName: "bcm-soft-local-api",
  database,
  password: requiredValue(localDatabaseEnvironment, "BCM_RUNTIME_PASSWORD"),
  port,
  role: requiredValue(localDatabaseEnvironment, "BCM_RUNTIME_ROLE"),
});
const migrationUrl = databaseUrl({
  applicationName: "bcm-soft-local-migration",
  database,
  password: requiredValue(localDatabaseEnvironment, "BCM_MIGRATION_PASSWORD"),
  port,
  role: requiredValue(localDatabaseEnvironment, "BCM_MIGRATION_ROLE"),
});
const serverEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  CSRF_HMAC_KEY: randomBytes(32).toString("base64url"),
  DATABASE_URL: runtimeUrl,
  DIRECT_DATABASE_URL: migrationUrl,
  NODE_ENV: "development",
  PORT: "3000",
  RATE_LIMIT_HMAC_KEY: randomBytes(32).toString("base64url"),
  TRUSTED_ORIGINS: "http://localhost:5173",
};

runPnpm(["run", "db:local:up"], process.env);
runPnpm(["run", "db:migrate:deploy"], serverEnvironment);
runPnpm(["run", "build"], serverEnvironment);
run(process.execPath, ["dist/main.js"], serverEnvironment);
