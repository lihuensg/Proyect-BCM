import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  assertSafeTestComposeProject,
  assertSafeTestDatabaseTarget,
  cleanupTestDatabase,
} from "../src/infrastructure/database/test-database-target.ts";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const composeFile = fileURLToPath(
  new URL("../../../infrastructure/postgres/compose.yaml", import.meta.url),
);
const suffix = randomBytes(6).toString("hex");
const projectName = `bcm-db001-test-${suffix}`;
const databaseName = `bcm_soft_test_${suffix}`;
const databaseUser = `bcm_test_${suffix}`;
const databasePassword = randomBytes(24).toString("base64url");
const composeEnvironment = {
  ...process.env,
  BCM_POSTGRES_DATABASE: databaseName,
  BCM_POSTGRES_PASSWORD: databasePassword,
  BCM_POSTGRES_PORT: "0",
  BCM_POSTGRES_USER: databaseUser,
};
const composeArguments = ["compose", "-p", projectName, "-f", composeFile];

function run(
  command: string,
  arguments_: string[],
  options: Readonly<{
    acceptedStatuses?: readonly number[];
    captureOutput?: boolean;
    environment?: NodeJS.ProcessEnv;
  }> = {},
): string {
  const result = spawnSync(command, arguments_, {
    cwd: apiDirectory,
    encoding: "utf8",
    env: options.environment ?? process.env,
    shell: false,
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  const acceptedStatuses = options.acceptedStatuses ?? [0];

  if (result.status === null || !acceptedStatuses.includes(result.status)) {
    throw new Error(`${command} exited with status ${String(result.status)}.`);
  }

  return [result.stdout, result.stderr]
    .filter((output): output is string => output !== undefined)
    .join("\n")
    .trim();
}

function runPnpm(arguments_: string[], environment: NodeJS.ProcessEnv): void {
  const pnpmExecutable = process.env.npm_execpath;

  if (pnpmExecutable === undefined || pnpmExecutable.length === 0) {
    throw new Error("pnpm execution path is unavailable.");
  }

  run(process.execPath, [pnpmExecutable, ...arguments_], { environment });
}

function buildDatabaseUrl(port: string): string {
  const databaseUrl = new URL("postgresql://127.0.0.1");
  databaseUrl.username = databaseUser;
  databaseUrl.password = databasePassword;
  databaseUrl.port = port;
  databaseUrl.pathname = databaseName;
  databaseUrl.searchParams.set("application_name", "bcm-soft-test");
  return databaseUrl.toString();
}

function resolvePublishedPort(): string {
  const output = run(
    "docker",
    [...composeArguments, "port", "postgres", "5432"],
    { captureOutput: true, environment: composeEnvironment },
  );
  const match = /:(\d+)$/.exec(output);

  if (match?.[1] === undefined) {
    throw new Error("PostgreSQL test port could not be resolved.");
  }

  return match[1];
}

function verifyCleanup(): void {
  const containers = run(
    "docker",
    [
      "ps",
      "--all",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
    ],
    { captureOutput: true },
  );
  const volumes = run(
    "docker",
    [
      "volume",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
    ],
    { captureOutput: true },
  );

  if (containers.length > 0 || volumes.length > 0) {
    throw new Error("PostgreSQL test cleanup left Docker resources behind.");
  }
}

async function main(): Promise<void> {
  assertSafeTestComposeProject(projectName);
  let databaseUrl = buildDatabaseUrl("5432");
  let cleanupRequired = false;

  assertSafeTestDatabaseTarget(databaseUrl, "test");

  try {
    cleanupRequired = true;
    run("docker", [...composeArguments, "up", "--detach", "--wait"], {
      environment: composeEnvironment,
    });
    databaseUrl = buildDatabaseUrl(resolvePublishedPort());
    assertSafeTestDatabaseTarget(databaseUrl, "test");

    const testEnvironment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      PORT: "0",
      TEST_DATABASE_URL: databaseUrl,
    };

    runPnpm(
      ["exec", "prisma", "migrate", "deploy", "--config", "prisma.config.ts"],
      testEnvironment,
    );
    const migrationStatus = run(
      process.execPath,
      [
        process.env.npm_execpath ?? "",
        "exec",
        "prisma",
        "migrate",
        "status",
        "--config",
        "prisma.config.ts",
      ],
      {
        acceptedStatuses: [0, 1],
        captureOutput: true,
        environment: testEnvironment,
      },
    );

    if (
      !migrationStatus.includes("No migration found in prisma/migrations") &&
      !migrationStatus.includes("Database schema is up to date")
    ) {
      throw new Error("Prisma migration status is not consistent.");
    }
    runPnpm(
      [
        "exec",
        "vitest",
        "run",
        "test/integration/database",
        "--environment",
        "node",
        "--maxWorkers",
        "1",
        "--no-file-parallelism",
      ],
      testEnvironment,
    );
  } finally {
    if (cleanupRequired) {
      await cleanupTestDatabase(databaseUrl, "test", projectName, async () => {
        run(
          "docker",
          [
            ...composeArguments,
            "down",
            "--volumes",
            "--remove-orphans",
            "--timeout",
            "5",
          ],
          { environment: composeEnvironment },
        );
      });
      verifyCleanup();
    }
  }
}

await main();
