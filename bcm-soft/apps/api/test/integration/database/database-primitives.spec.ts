import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadServerConfig } from "../../../src/config/server-config.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import { assertSafeTestDatabaseTarget } from "../../../src/infrastructure/database/test-database-target.js";

type PrimitiveRow = Readonly<{
  created_at: Date;
  exchange_rate: { toFixed(decimalPlaces: number): string };
  id: string;
  intermediate_amount: { toFixed(decimalPlaces: number): string };
  money_amount: { toFixed(decimalPlaces: number): string };
  updated_at: Date;
}>;

describe("PostgreSQL database primitives", () => {
  const lifecycle = new PrismaClientLifecycle(
    loadServerConfig(process.env).database.runtimeUrl,
  );
  const sqlClient = new Client({
    connectionString: loadServerConfig(process.env).database.runtimeUrl,
  });

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
    assertSafeTestDatabaseTarget(databaseUrl, process.env.NODE_ENV);

    await sqlClient.connect();
    await lifecycle.connect();
  });

  afterAll(async () => {
    await lifecycle.disconnect();
    await sqlClient.end();
  });

  it("round-trips an application-owned UUIDv7 through PostgreSQL uuid", async () => {
    const parentId = generateUuidV7();
    const identifier = generateUuidV7();

    await sqlClient.query(
      "INSERT INTO test_primitive_parents (id) VALUES ($1::uuid)",
      [parentId],
    );
    await sqlClient.query(
      `INSERT INTO test_database_primitives (
        id,
        parent_id,
        created_at,
        updated_at,
        money_amount,
        exchange_rate,
        intermediate_amount,
        reference_normalized
      ) VALUES ($1::uuid, $2::uuid, now(), now(), 0, 1, 0, $3)`,
      [identifier, parentId, `uuid-${identifier}`],
    );

    const result = await sqlClient.query<{ id: string }>(
      "SELECT id FROM test_database_primitives WHERE id = $1::uuid",
      [identifier],
    );

    expect(result.rows).toEqual([{ id: identifier }]);
  });

  it("preserves one instant represented by different offsets in timestamptz(3)", async () => {
    const firstRepresentation = "2026-08-16T12:34:56.789-03:00";
    const secondRepresentation = "2026-08-16T15:34:56.789Z";
    const result = await lifecycle.client.$queryRaw<
      Array<{ first_instant: Date; second_instant: Date }>
    >`SELECT
        ${firstRepresentation}::timestamptz(3) AS first_instant,
        ${secondRepresentation}::timestamptz(3) AS second_instant`;

    expect(result).toHaveLength(1);
    expect(result[0]?.first_instant.getTime()).toBe(
      result[0]?.second_instant.getTime(),
    );
    expect(result[0]?.first_instant.toISOString()).toBe(
      "2026-08-16T15:34:56.789Z",
    );
  });

  it("round-trips exact Decimal values without binary floating point", async () => {
    const identifier = generateUuidV7();
    const parentId = generateUuidV7();
    const money = "99999999999999999.99";
    const exchangeRate = "999999999999.12345678";
    const intermediate = "99999999999999999999999999.123456789012";

    await sqlClient.query(
      "INSERT INTO test_primitive_parents (id) VALUES ($1::uuid)",
      [parentId],
    );
    await sqlClient.query(
      `INSERT INTO test_database_primitives (
        id,
        parent_id,
        created_at,
        updated_at,
        money_amount,
        exchange_rate,
        intermediate_amount,
        reference_normalized
      ) VALUES (
        $1::uuid,
        $2::uuid,
        '2026-08-16T15:34:56.789Z'::timestamptz(3),
        '2026-08-16T15:34:56.789Z'::timestamptz(3),
        $3::numeric(19,2),
        $4::numeric(20,8),
        $5::numeric(38,12),
        $6
      )`,
      [
        identifier,
        parentId,
        money,
        exchangeRate,
        intermediate,
        `decimal-${identifier}`,
      ],
    );

    const rows = await lifecycle.client.$queryRaw<PrimitiveRow[]>`
      SELECT
        id,
        created_at,
        updated_at,
        money_amount,
        exchange_rate,
        intermediate_amount
      FROM test_database_primitives
      WHERE id = ${identifier}::uuid
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(identifier);
    expect(rows[0]?.money_amount.toFixed(2)).toBe(money);
    expect(rows[0]?.exchange_rate.toFixed(8)).toBe(exchangeRate);
    expect(rows[0]?.intermediate_amount.toFixed(12)).toBe(intermediate);
  });

  it("materializes the approved physical types and naming in PostgreSQL catalogs", async () => {
    const columns = await sqlClient.query<{
      column_name: string;
      data_type: string;
      datetime_precision: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
    }>(`
      SELECT
        column_name,
        data_type,
        datetime_precision,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'test_database_primitives'
      ORDER BY ordinal_position
    `);
    const columnByName = new Map(
      columns.rows.map((column) => [column.column_name, column]),
    );

    expect(columnByName.get("id")?.data_type).toBe("uuid");
    expect(columnByName.get("created_at")).toMatchObject({
      data_type: "timestamp with time zone",
      datetime_precision: 3,
    });
    expect(columnByName.get("updated_at")?.data_type).toBe(
      "timestamp with time zone",
    );
    expect(columnByName.get("money_amount")).toMatchObject({
      data_type: "numeric",
      numeric_precision: 19,
      numeric_scale: 2,
    });
    expect(columnByName.get("exchange_rate")).toMatchObject({
      data_type: "numeric",
      numeric_precision: 20,
      numeric_scale: 8,
    });
    expect(columnByName.get("intermediate_amount")).toMatchObject({
      data_type: "numeric",
      numeric_precision: 38,
      numeric_scale: 12,
    });
    expect(columns.rows.some(({ data_type }) => data_type === "real")).toBe(
      false,
    );
    expect(
      columns.rows.some(({ data_type }) => data_type === "double precision"),
    ).toBe(false);
    expect(
      columns.rows.some(
        ({ data_type }) => data_type === "timestamp without time zone",
      ),
    ).toBe(false);

    const constraints = await sqlClient.query<{ conname: string }>(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'test_database_primitives'::regclass
      ORDER BY conname
    `);
    expect(constraints.rows.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        "pk_test_database_primitives",
        "fk_test_database_primitives__parent_id__test_primitive_parents",
        "uq_test_database_primitives__reference_normalized",
        "ck_test_database_primitives__money_amount_nonnegative",
      ]),
    );

    const indexes = await sqlClient.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'test_database_primitives'
      ORDER BY indexname
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "ix_test_database_primitives__created_at",
        "ux_test_database_primitives__active_code_normalized__active",
      ]),
    );
  });
});
