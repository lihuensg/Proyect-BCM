import { afterEach, describe, expect, it } from "vitest";

import { loadServerConfig } from "../../../src/config/server-config.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { assertSafeTestDatabaseTarget } from "../../../src/infrastructure/database/test-database-target.js";

describe("Prisma PostgreSQL foundation", () => {
  let lifecycle: PrismaClientLifecycle | undefined;

  afterEach(async () => {
    await lifecycle?.disconnect();
    lifecycle = undefined;
  });

  it("connects to the isolated PostgreSQL test database and closes its pool", async () => {
    const config = loadServerConfig(process.env);
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;

    expect(testDatabaseUrl).toBe(config.database.runtimeUrl);
    assertSafeTestDatabaseTarget(testDatabaseUrl ?? "", process.env.NODE_ENV);

    const expectedDatabase = new URL(config.database.runtimeUrl).pathname.slice(
      1,
    );
    lifecycle = new PrismaClientLifecycle(config.database.runtimeUrl);

    const firstClient = await lifecycle.connect();
    const secondClient = await lifecycle.connect();
    const result = await firstClient.$queryRaw<
      Array<{ current_database: string; server_version: string }>
    >`SELECT current_database(), current_setting('server_version') AS server_version`;

    expect(secondClient).toBe(firstClient);
    expect(lifecycle.connected).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.current_database).toBe(expectedDatabase);
    expect(result[0]?.server_version).toMatch(/^18\./);

    await lifecycle.disconnect();
    await lifecycle.disconnect();

    expect(lifecycle.connected).toBe(false);
  });
});
