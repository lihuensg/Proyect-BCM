import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
  assertSafeTestComposeProject,
  assertSafeTestDatabaseTarget,
  cleanupTestDatabase,
} from "../src/infrastructure/database/test-database-target.ts";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const composeFile = fileURLToPath(
  new URL("../../../infrastructure/postgres/compose.yaml", import.meta.url),
);
const databasePrimitivesFixture = new URL(
  "../test/fixtures/database/database-primitives.sql",
  import.meta.url,
);
const tenantRlsFixture = new URL(
  "../test/fixtures/database/tenant-rls-probe.sql",
  import.meta.url,
);
const identityFoundationMigration = new URL(
  "../prisma/migrations/20260816180000_identity_tenant_security_foundation/migration.sql",
  import.meta.url,
);
const suffix = randomBytes(6).toString("hex");
const projectName = `bcm-db001-test-${suffix}`;
const databaseName = `bcm_soft_test_${suffix}`;
const shadowDatabaseName = `${databaseName}_shadow`;
const upgradeDatabaseName = `${databaseName}_upgrade`;
const adminRole = `bcm_test_admin_${suffix}`;
const migrationRole = `bcm_test_migration_${suffix}`;
const runtimeRole = `bcm_test_runtime_${suffix}`;
const adminPassword = randomBytes(24).toString("base64url");
const migrationPassword = randomBytes(24).toString("base64url");
const runtimePassword = randomBytes(24).toString("base64url");
const composeEnvironment = {
  ...process.env,
  BCM_MIGRATION_PASSWORD: migrationPassword,
  BCM_MIGRATION_ROLE: migrationRole,
  BCM_POSTGRES_DATABASE: databaseName,
  BCM_POSTGRES_PASSWORD: adminPassword,
  BCM_POSTGRES_PORT: "0",
  BCM_POSTGRES_USER: adminRole,
  BCM_RUNTIME_PASSWORD: runtimePassword,
  BCM_RUNTIME_ROLE: runtimeRole,
  BCM_SHADOW_DATABASE: shadowDatabaseName,
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

  if (result.error !== undefined) throw result.error;

  const acceptedStatuses = options.acceptedStatuses ?? [0];
  if (result.status === null || !acceptedStatuses.includes(result.status)) {
    throw new Error(`${command} exited with status ${String(result.status)}.`);
  }

  return [result.stdout, result.stderr]
    .filter((output): output is string => output !== undefined)
    .join("\n")
    .trim();
}

function runPnpm(
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
  options: Readonly<{
    acceptedStatuses?: readonly number[];
    captureOutput?: boolean;
  }> = {},
): string {
  const pnpmExecutable = process.env.npm_execpath;
  if (pnpmExecutable === undefined || pnpmExecutable.length === 0) {
    throw new Error("pnpm execution path is unavailable.");
  }
  return run(process.execPath, [pnpmExecutable, ...arguments_], {
    ...options,
    environment,
  });
}

function buildDatabaseUrl(
  port: string,
  database: string,
  role: string,
  password: string,
): string {
  const databaseUrl = new URL("postgresql://127.0.0.1");
  databaseUrl.username = role;
  databaseUrl.password = password;
  databaseUrl.port = port;
  databaseUrl.pathname = database;
  databaseUrl.searchParams.set("application_name", "bcm-soft-test");
  return databaseUrl.toString();
}

function migrationEnvironment(
  runtimeUrl: string,
  migrationUrl: string,
  shadowDatabaseUrl: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: runtimeUrl,
    DIRECT_DATABASE_URL: migrationUrl,
    NODE_ENV: "test",
    PORT: "0",
    SHADOW_DATABASE_URL: shadowDatabaseUrl,
    TEST_DATABASE_URL: runtimeUrl,
  };
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

function verifyMigrationStatus(environment: NodeJS.ProcessEnv): void {
  const status = runPnpm(
    ["exec", "prisma", "migrate", "status", "--config", "prisma.config.ts"],
    environment,
    { acceptedStatuses: [0, 1], captureOutput: true },
  );
  if (!status.includes("Database schema is up to date")) {
    throw new Error("Prisma migration status is not consistent.");
  }
}

async function executeSql(databaseUrl: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function verifyUpgradePath(port: string): Promise<void> {
  run(
    "docker",
    [
      ...composeArguments,
      "exec",
      "--no-TTY",
      "postgres",
      "createdb",
      "--username",
      adminRole,
      "--owner",
      adminRole,
      upgradeDatabaseName,
    ],
    { environment: composeEnvironment },
  );
  run(
    "docker",
    [
      ...composeArguments,
      "exec",
      "--no-TTY",
      "--env",
      `POSTGRES_DB=${upgradeDatabaseName}`,
      "postgres",
      "psql",
      "--username",
      adminRole,
      "--dbname",
      upgradeDatabaseName,
      "--file",
      "/docker-entrypoint-initdb.d/10-bcm-roles.sql",
    ],
    { environment: composeEnvironment },
  );

  const runtimeUrl = buildDatabaseUrl(
    port,
    upgradeDatabaseName,
    runtimeRole,
    runtimePassword,
  );
  const migrationUrl = buildDatabaseUrl(
    port,
    upgradeDatabaseName,
    migrationRole,
    migrationPassword,
  );
  const shadowDatabaseUrl = buildDatabaseUrl(
    port,
    shadowDatabaseName,
    migrationRole,
    migrationPassword,
  );
  const environment = migrationEnvironment(
    runtimeUrl,
    migrationUrl,
    shadowDatabaseUrl,
  );
  assertSafeTestDatabaseTarget(runtimeUrl, "test");
  assertSafeTestDatabaseTarget(migrationUrl, "test");
  assertSafeTestDatabaseTarget(shadowDatabaseUrl, "test");

  await executeSql(
    migrationUrl,
    await readFile(identityFoundationMigration, "utf8"),
  );
  runPnpm(
    [
      "exec",
      "prisma",
      "migrate",
      "resolve",
      "--applied",
      "20260816180000_identity_tenant_security_foundation",
      "--config",
      "prisma.config.ts",
    ],
    environment,
  );
  runPnpm(
    ["exec", "prisma", "migrate", "deploy", "--config", "prisma.config.ts"],
    environment,
  );
  verifyMigrationStatus(environment);
}

function verifyCleanup(): void {
  const resources = [
    ["ps", "--all", "--quiet", "--filter"],
    ["volume", "ls", "--quiet", "--filter"],
    ["network", "ls", "--quiet", "--filter"],
  ].map((arguments_) =>
    run(
      "docker",
      [...arguments_, `label=com.docker.compose.project=${projectName}`],
      { captureOutput: true },
    ),
  );
  if (resources.some((resource) => resource.length > 0)) {
    throw new Error("PostgreSQL test cleanup left Docker resources behind.");
  }
}

async function main(): Promise<void> {
  assertSafeTestComposeProject(projectName);
  let runtimeDatabaseUrl = buildDatabaseUrl(
    "5432",
    databaseName,
    runtimeRole,
    runtimePassword,
  );
  let cleanupRequired = false;
  assertSafeTestDatabaseTarget(runtimeDatabaseUrl, "test");

  try {
    cleanupRequired = true;
    run("docker", [...composeArguments, "up", "--detach", "--wait"], {
      environment: composeEnvironment,
    });
    const port = resolvePublishedPort();
    runtimeDatabaseUrl = buildDatabaseUrl(
      port,
      databaseName,
      runtimeRole,
      runtimePassword,
    );
    const migrationDatabaseUrl = buildDatabaseUrl(
      port,
      databaseName,
      migrationRole,
      migrationPassword,
    );
    const shadowDatabaseUrl = buildDatabaseUrl(
      port,
      shadowDatabaseName,
      migrationRole,
      migrationPassword,
    );
    const environment = migrationEnvironment(
      runtimeDatabaseUrl,
      migrationDatabaseUrl,
      shadowDatabaseUrl,
    );
    assertSafeTestDatabaseTarget(runtimeDatabaseUrl, "test");
    assertSafeTestDatabaseTarget(migrationDatabaseUrl, "test");
    assertSafeTestDatabaseTarget(shadowDatabaseUrl, "test");

    runPnpm(
      ["exec", "prisma", "migrate", "deploy", "--config", "prisma.config.ts"],
      environment,
    );
    verifyMigrationStatus(environment);

    const runtimeMigrationAttempt = runPnpm(
      ["exec", "prisma", "migrate", "deploy", "--config", "prisma.config.ts"],
      migrationEnvironment(
        runtimeDatabaseUrl,
        runtimeDatabaseUrl,
        shadowDatabaseUrl,
      ),
      { acceptedStatuses: [1], captureOutput: true },
    );
    if (
      !/permission denied|P1010|denied access/i.test(runtimeMigrationAttempt)
    ) {
      throw new Error("Runtime migration denial was not demonstrated.");
    }

    await verifyUpgradePath(port);
    await executeSql(
      migrationDatabaseUrl,
      await readFile(databasePrimitivesFixture, "utf8"),
    );
    await executeSql(
      migrationDatabaseUrl,
      await readFile(tenantRlsFixture, "utf8"),
    );

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
      {
        ...environment,
        BCM_RUNTIME_CAPABILITY_ROLE: "bcm_soft_runtime",
        BCM_TEST_ADMIN_ROLE: adminRole,
        BCM_TEST_MIGRATION_ROLE: migrationRole,
        BCM_TEST_RUNTIME_ROLE: runtimeRole,
        BCM_TEST_SHADOW_DATABASE: shadowDatabaseName,
      },
    );
  } finally {
    if (cleanupRequired) {
      await cleanupTestDatabase(
        runtimeDatabaseUrl,
        "test",
        projectName,
        async () => {
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
        },
      );
      verifyCleanup();
    }
  }
}

await main();
