const TEST_DATABASE_PREFIX = "bcm_soft_test_";
const TEST_USER_PREFIX = "bcm_test_";
const TEST_APPLICATION_NAME = "bcm-soft-test";
const TEST_COMPOSE_PROJECT_PREFIX = "bcm-db001-test-";

export function assertSafeTestDatabaseTarget(
  databaseUrl: string,
  runtimeEnvironment: string | undefined,
): URL {
  if (runtimeEnvironment !== "test") {
    throw new Error("Test database cleanup requires NODE_ENV=test.");
  }

  let target: URL;

  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("Test database target is not an allowed local URL.");
  }

  const databaseName = target.pathname.slice(1);
  const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    target.hostname,
  );

  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !isLoopback ||
    !databaseName.startsWith(TEST_DATABASE_PREFIX) ||
    !target.username.startsWith(TEST_USER_PREFIX) ||
    target.password.length < 24 ||
    target.searchParams.get("application_name") !== TEST_APPLICATION_NAME
  ) {
    throw new Error("Test database target is not an allowed local URL.");
  }

  return target;
}

export function assertSafeTestComposeProject(projectName: string): void {
  if (
    !projectName.startsWith(TEST_COMPOSE_PROJECT_PREFIX) ||
    !/^bcm-db001-test-[a-f0-9]{12}$/.test(projectName)
  ) {
    throw new Error("Test database cleanup project is not allowed.");
  }
}

export async function cleanupTestDatabase(
  databaseUrl: string,
  runtimeEnvironment: string | undefined,
  projectName: string,
  cleanup: () => Promise<void>,
): Promise<void> {
  assertSafeTestDatabaseTarget(databaseUrl, runtimeEnvironment);
  assertSafeTestComposeProject(projectName);
  await cleanup();
}
