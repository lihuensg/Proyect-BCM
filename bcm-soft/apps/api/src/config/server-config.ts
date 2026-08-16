import {
  loadRuntimeDatabaseConfig,
  type RuntimeDatabaseConfig,
} from "./database-config.js";

type RuntimeEnvironment = "development" | "test" | "production";

export type ServerConfig = Readonly<{
  database: RuntimeDatabaseConfig;
  environment: RuntimeEnvironment;
  port: number;
}>;

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

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const runtimeEnvironment = readRuntimeEnvironment(environment);

  return Object.freeze({
    database: loadRuntimeDatabaseConfig(environment),
    environment: runtimeEnvironment,
    port: readPort(environment, runtimeEnvironment),
  });
}
