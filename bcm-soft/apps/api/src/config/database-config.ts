export type RuntimeDatabaseConfig = Readonly<{
  runtimeUrl: string;
}>;

export type MigrationDatabaseConfig = Readonly<{
  migrationUrl: string;
}>;

function databaseConfigurationError(
  variableName: string,
  reason: string,
): never {
  throw new Error(`Invalid server configuration: ${variableName} ${reason}.`);
}

function readPostgreSqlUrl(
  environment: NodeJS.ProcessEnv,
  variableName: "DATABASE_URL" | "DIRECT_DATABASE_URL",
): string {
  const value = environment[variableName];

  if (value === undefined || value.length === 0) {
    return databaseConfigurationError(variableName, "is required");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    return databaseConfigurationError(variableName, "must be a PostgreSQL URL");
  }

  if (
    !["postgres:", "postgresql:"].includes(parsedUrl.protocol) ||
    parsedUrl.hostname.length === 0 ||
    parsedUrl.username.length === 0 ||
    parsedUrl.password.length === 0 ||
    parsedUrl.pathname.length <= 1
  ) {
    return databaseConfigurationError(variableName, "must be a PostgreSQL URL");
  }

  return value;
}

export function loadRuntimeDatabaseConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeDatabaseConfig {
  return Object.freeze({
    runtimeUrl: readPostgreSqlUrl(environment, "DATABASE_URL"),
  });
}

export function loadMigrationDatabaseConfig(
  environment: NodeJS.ProcessEnv,
): MigrationDatabaseConfig {
  return Object.freeze({
    migrationUrl: readPostgreSqlUrl(environment, "DIRECT_DATABASE_URL"),
  });
}
