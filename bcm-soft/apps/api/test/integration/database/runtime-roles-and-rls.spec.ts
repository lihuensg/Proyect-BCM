import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadServerConfig } from "../../../src/config/server-config.js";
import { PrismaClientLifecycle } from "../../../src/infrastructure/database/prisma-client-lifecycle.js";
import { withTenantTransaction } from "../../../src/infrastructure/database/tenant-transaction.js";

const organizationA = "0198d5a0-0000-7000-8000-000000000001";
const organizationB = "0198d5a0-0000-7000-8000-000000000002";
const parentA = "0198d5a0-0002-7000-8000-000000000001";
const parentB = "0198d5a0-0002-7000-8000-000000000002";

type ProbeRow = Readonly<{ organization_id: string; probe_value: string }>;

describe("runtime database roles and transaction-local tenant context", () => {
  const runtimeUrl = loadServerConfig(process.env).database.runtimeUrl;
  const lifecycle = new PrismaClientLifecycle(runtimeUrl, { max: 1 });
  const runtimeSql = new Client({ connectionString: runtimeUrl });
  const migrationSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });

  beforeAll(async () => {
    await runtimeSql.connect();
    await migrationSql.connect();
    await lifecycle.connect();
  });

  afterAll(async () => {
    await lifecycle.disconnect();
    await migrationSql.end();
    await runtimeSql.end();
  });

  it("keeps migration, capability, and runtime roles non-privileged and distinct", async () => {
    const roleNames = [
      process.env.BCM_TEST_MIGRATION_ROLE,
      process.env.BCM_RUNTIME_CAPABILITY_ROLE,
      process.env.BCM_TEST_RUNTIME_ROLE,
    ];
    const result = await migrationSql.query<{
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolname: string;
      rolreplication: boolean;
      rolsuper: boolean;
    }>(
      `SELECT
        rolname,
        rolsuper,
        rolinherit,
        rolcreaterole,
        rolcreatedb,
        rolcanlogin,
        rolreplication,
        rolbypassrls
      FROM pg_roles
      WHERE rolname = ANY($1::text[])
      ORDER BY rolname`,
      [roleNames],
    );

    expect(result.rows).toHaveLength(3);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rolname: process.env.BCM_TEST_MIGRATION_ROLE,
          rolcanlogin: true,
          rolinherit: false,
        }),
        expect.objectContaining({
          rolname: process.env.BCM_RUNTIME_CAPABILITY_ROLE,
          rolcanlogin: false,
          rolinherit: false,
        }),
        expect.objectContaining({
          rolname: process.env.BCM_TEST_RUNTIME_ROLE,
          rolcanlogin: true,
          rolinherit: true,
        }),
      ]),
    );
    for (const role of result.rows) {
      expect(role).toMatchObject({
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolsuper: false,
      });
    }
  });

  it("keeps database, schema, and durable objects under their intended owners", async () => {
    const databaseAndSchema = await migrationSql.query<{
      database_owner: string;
      schema_owner: string;
      shadow_database_owner: string;
    }>(
      `
      SELECT
        pg_get_userbyid(database.datdba) AS database_owner,
        pg_get_userbyid(namespace.nspowner) AS schema_owner,
        (
          SELECT pg_get_userbyid(shadow.datdba)
          FROM pg_database AS shadow
          WHERE shadow.datname = $1
        ) AS shadow_database_owner
      FROM pg_database AS database
      CROSS JOIN pg_namespace AS namespace
      WHERE database.datname = current_database()
        AND namespace.nspname = 'public'
    `,
      [process.env.BCM_TEST_SHADOW_DATABASE],
    );
    const owners = await migrationSql.query<{ owner: string }>(`
      SELECT DISTINCT pg_get_userbyid(relowner) AS owner
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind IN ('r', 'i')
        AND relname NOT LIKE 'test_%'
    `);
    const privileges = await runtimeSql.query<{
      can_create_schema_objects: boolean;
      can_insert_organization: boolean;
      can_select_organization: boolean;
      can_truncate_sessions: boolean;
      can_use_schema: boolean;
    }>(`
      SELECT
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema_objects,
        has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
        has_table_privilege(current_user, 'organizations', 'SELECT') AS can_select_organization,
        has_table_privilege(current_user, 'organizations', 'INSERT') AS can_insert_organization,
        has_table_privilege(current_user, 'sessions', 'TRUNCATE') AS can_truncate_sessions
    `);

    expect(databaseAndSchema.rows).toEqual([
      {
        database_owner: process.env.BCM_TEST_ADMIN_ROLE,
        schema_owner: process.env.BCM_TEST_MIGRATION_ROLE,
        shadow_database_owner: process.env.BCM_TEST_MIGRATION_ROLE,
      },
    ]);
    expect(owners.rows).toEqual([
      { owner: process.env.BCM_TEST_MIGRATION_ROLE },
    ]);
    expect(privileges.rows).toEqual([
      {
        can_create_schema_objects: false,
        can_insert_organization: false,
        can_select_organization: true,
        can_truncate_sessions: false,
        can_use_schema: true,
      },
    ]);
  });

  it("removes PUBLIC connect and schema-create privileges", async () => {
    const result = await migrationSql.query<{
      public_can_connect: boolean;
      public_can_create_in_schema: boolean;
    }>(`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_database AS database,
            LATERAL aclexplode(
              COALESCE(database.datacl, acldefault('d', database.datdba))
            ) AS acl
          WHERE database.datname = current_database()
            AND acl.grantee = 0
            AND acl.privilege_type = 'CONNECT'
        ) AS public_can_connect,
        EXISTS (
          SELECT 1
          FROM pg_namespace AS namespace,
            LATERAL aclexplode(
              COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
            ) AS acl
          WHERE namespace.nspname = 'public'
            AND acl.grantee = 0
            AND acl.privilege_type = 'CREATE'
        ) AS public_can_create_in_schema
    `);

    expect(result.rows).toEqual([
      { public_can_connect: false, public_can_create_in_schema: false },
    ]);
  });

  it("materializes explicit runtime membership, table grants, and schema usage", async () => {
    const membership = await migrationSql.query<{
      capability_role: string;
      runtime_role: string;
    }>(
      `
      SELECT capability.rolname AS capability_role, member.rolname AS runtime_role
      FROM pg_auth_members AS membership
      JOIN pg_roles AS capability ON capability.oid = membership.roleid
      JOIN pg_roles AS member ON member.oid = membership.member
      WHERE capability.rolname = 'bcm_soft_runtime'
        AND member.rolname = $1
    `,
      [process.env.BCM_TEST_RUNTIME_ROLE],
    );
    const tableGrants = await migrationSql.query<{
      privilege_type: string;
      table_name: string;
    }>(`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'bcm_soft_runtime'
        AND table_schema = 'public'
        AND table_name NOT LIKE 'test_%'
      ORDER BY table_name, privilege_type
    `);
    const usageGrants = await migrationSql.query<{ object_name: string }>(`
      SELECT object_name
      FROM information_schema.role_usage_grants
      WHERE grantee = 'bcm_soft_runtime'
        AND object_type = 'SCHEMA'
    `);

    expect(membership.rows).toEqual([
      {
        capability_role: "bcm_soft_runtime",
        runtime_role: process.env.BCM_TEST_RUNTIME_ROLE,
      },
    ]);
    expect(tableGrants.rows).toHaveLength(26);
    expect(tableGrants.rows).toContainEqual({
      privilege_type: "SELECT",
      table_name: "organizations",
    });
    expect(tableGrants.rows).not.toContainEqual(
      expect.objectContaining({ privilege_type: "TRUNCATE" }),
    );
    expect(usageGrants.rows).toEqual([]);
  });

  it("enables and forces RLS only on the test probe", async () => {
    const result = await migrationSql.query<{
      relforcerowsecurity: boolean;
      relname: string;
      relrowsecurity: boolean;
    }>(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind = 'r'
      ORDER BY relname
    `);
    const byTable = new Map(result.rows.map((row) => [row.relname, row]));

    expect(byTable.get("test_tenant_rls_probe")).toMatchObject({
      relforcerowsecurity: true,
      relrowsecurity: true,
    });
    for (const table of [
      "identity_rate_limit_windows",
      "organization_invitations",
      "organization_memberships",
      "organizations",
      "password_recovery_tokens",
      "sessions",
      "user_password_credentials",
      "users",
    ]) {
      expect(byTable.get(table)).toMatchObject({
        relforcerowsecurity: false,
        relrowsecurity: false,
      });
    }
  });

  it("uses a restricted runtime login that inherits only the capability role", async () => {
    const runtimeRole = process.env.BCM_TEST_RUNTIME_ROLE;
    const capabilityRole = process.env.BCM_RUNTIME_CAPABILITY_ROLE;
    const result = await runtimeSql.query<{
      current_user: string;
      inherits_capability: boolean;
      session_user: string;
    }>(
      `SELECT
        current_user,
        session_user,
        pg_has_role(current_user, $1, 'MEMBER') AS inherits_capability`,
      [capabilityRole],
    );

    expect(result.rows).toEqual([
      {
        current_user: runtimeRole,
        inherits_capability: true,
        session_user: runtimeRole,
      },
    ]);
  });

  it("denies runtime DDL, policy changes, schema changes, and migration metadata", async () => {
    const deniedStatements = [
      "CREATE TABLE runtime_must_not_create (id uuid)",
      "ALTER TABLE organizations ADD COLUMN runtime_must_not_add text",
      "DROP TABLE organizations",
      "ALTER TABLE test_tenant_rls_probe DISABLE ROW LEVEL SECURITY",
      "ALTER POLICY test_tenant_rls_probe__tenant_isolation ON test_tenant_rls_probe USING (true)",
      "CREATE POLICY runtime_must_not_create ON test_tenant_rls_probe USING (true)",
      "CREATE SCHEMA runtime_must_not_create",
    ];

    for (const statement of deniedStatements) {
      await expect(runtimeSql.query(statement)).rejects.toMatchObject({
        code: "42501",
      });
    }
    await expect(
      runtimeSql.query("SELECT * FROM _prisma_migrations"),
    ).rejects.toMatchObject({ code: "42501" });

    const intact = await migrationSql.query<{
      policy_count: string;
      probe_forced: boolean;
      probe_rls: boolean;
    }>(`
      SELECT
        (SELECT count(*)::text FROM pg_policy
          WHERE polrelid = 'test_tenant_rls_probe'::regclass) AS policy_count,
        relrowsecurity AS probe_rls,
        relforcerowsecurity AS probe_forced
      FROM pg_class
      WHERE oid = 'test_tenant_rls_probe'::regclass
    `);
    expect(intact.rows).toEqual([
      { policy_count: "1", probe_forced: true, probe_rls: true },
    ]);
  });

  it("fails closed without tenant context", async () => {
    const rows = await lifecycle.client.$queryRaw<ProbeRow[]>`
      SELECT organization_id, probe_value
      FROM test_tenant_rls_probe
      ORDER BY probe_value
    `;

    expect(rows).toEqual([]);

    await expect(
      lifecycle.client.$executeRaw`
        INSERT INTO test_tenant_rls_probe (id, organization_id, parent_id, probe_value)
        VALUES (
          '0198d5a0-0001-7000-8000-000000000005'::uuid,
          ${organizationA}::uuid,
          ${parentA}::uuid,
          'missing-context'
        )
      `,
    ).rejects.toMatchObject({ code: "P2010" });
    const updateCount = await lifecycle.client.$executeRaw`
      UPDATE test_tenant_rls_probe SET probe_value = 'missing-context'
    `;
    const deleteCount = await lifecycle.client.$executeRaw`
      DELETE FROM test_tenant_rls_probe
    `;
    expect(updateCount).toBe(0);
    expect(deleteCount).toBe(0);
  });

  it("isolates tenant A and tenant B inside transaction-local context", async () => {
    const tenantARows = await withTenantTransaction(
      lifecycle.client,
      organizationA,
      (transaction) =>
        transaction.$queryRaw<ProbeRow[]>`
          SELECT organization_id, probe_value
          FROM test_tenant_rls_probe
          ORDER BY probe_value
        `,
    );
    const tenantBRows = await withTenantTransaction(
      lifecycle.client,
      organizationB,
      (transaction) =>
        transaction.$queryRaw<ProbeRow[]>`
          SELECT organization_id, probe_value
          FROM test_tenant_rls_probe
          ORDER BY probe_value
        `,
    );

    expect(tenantARows).toEqual([
      { organization_id: organizationA, probe_value: "tenant-a" },
    ]);
    expect(tenantBRows).toEqual([
      { organization_id: organizationB, probe_value: "tenant-b" },
    ]);
  });

  it("rejects cross-tenant writes through WITH CHECK", async () => {
    await expect(
      withTenantTransaction(
        lifecycle.client,
        organizationA,
        (transaction) =>
          transaction.$executeRaw`
          INSERT INTO test_tenant_rls_probe (id, organization_id, parent_id, probe_value)
          VALUES (
            '0198d5a0-0001-7000-8000-000000000003'::uuid,
            ${organizationB}::uuid,
            ${parentB}::uuid,
            'cross-tenant'
          )
        `,
      ),
    ).rejects.toMatchObject({ code: "P2010" });
  });

  it("permits tenant-local writes and blocks update, reassignment, and delete across tenants", async () => {
    const tenantARowId = "0198d5a0-0001-7000-8000-000000000004";

    await withTenantTransaction(
      lifecycle.client,
      organizationA,
      async (transaction) => {
        await transaction.$executeRaw`
        INSERT INTO test_tenant_rls_probe (id, organization_id, parent_id, probe_value)
        VALUES (
          ${tenantARowId}::uuid,
          ${organizationA}::uuid,
          ${parentA}::uuid,
          'tenant-a-created'
        )
      `;
        const localUpdateCount = await transaction.$executeRaw`
        UPDATE test_tenant_rls_probe
        SET probe_value = 'tenant-a-updated'
        WHERE id = ${tenantARowId}::uuid
      `;
        const foreignUpdateCount = await transaction.$executeRaw`
        UPDATE test_tenant_rls_probe
        SET probe_value = 'must-not-update'
        WHERE organization_id = ${organizationB}::uuid
      `;
        const foreignDeleteCount = await transaction.$executeRaw`
        DELETE FROM test_tenant_rls_probe
        WHERE organization_id = ${organizationB}::uuid
      `;

        expect(localUpdateCount).toBe(1);
        expect(foreignUpdateCount).toBe(0);
        expect(foreignDeleteCount).toBe(0);
      },
    );

    await expect(
      withTenantTransaction(
        lifecycle.client,
        organizationA,
        (transaction) =>
          transaction.$executeRaw`
          UPDATE test_tenant_rls_probe
          SET organization_id = ${organizationB}::uuid
          WHERE id = ${tenantARowId}::uuid
        `,
      ),
    ).rejects.toMatchObject({ code: "P2010" });
  });

  it("rejects a cross-tenant parent through the composite tenant-aware FK", async () => {
    await expect(
      withTenantTransaction(
        lifecycle.client,
        organizationA,
        (transaction) =>
          transaction.$executeRaw`
          INSERT INTO test_tenant_rls_probe (id, organization_id, parent_id, probe_value)
          VALUES (
            '0198d5a0-0001-7000-8000-000000000006'::uuid,
            ${organizationA}::uuid,
            ${parentB}::uuid,
            'cross-tenant-parent'
          )
        `,
      ),
    ).rejects.toMatchObject({ code: "P2010" });

    const constraint = await migrationSql.query<{ conname: string }>(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'test_tenant_rls_probe'::regclass
        AND contype = 'f'
    `);
    expect(constraint.rows).toEqual([
      {
        conname: "fk_test_tenant_rls_probe__tenant_parent",
      },
    ]);
  });

  it("rejects malformed and non-v7 tenant identifiers before opening context", async () => {
    await expect(
      withTenantTransaction(
        lifecycle.client,
        "not-a-uuid",
        async () => undefined,
      ),
    ).rejects.toThrow("A valid UUIDv7 organization identifier is required.");
    await expect(
      withTenantTransaction(
        lifecycle.client,
        "550e8400-e29b-41d4-a716-446655440000",
        async () => undefined,
      ),
    ).rejects.toThrow("A valid UUIDv7 organization identifier is required.");
  });

  it("clears tenant context after commit on a reused pooled connection", async () => {
    const transactionPid = await withTenantTransaction(
      lifecycle.client,
      organizationA,
      (transaction) =>
        transaction.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `,
    );
    const afterCommit = await lifecycle.client.$queryRaw<
      Array<{ organization_id: string | null; pid: number }>
    >`
      SELECT
        nullif(current_setting('bcm.current_organization_id', true), '') AS organization_id,
        pg_backend_pid() AS pid
    `;

    expect(afterCommit[0]?.pid).toBe(transactionPid[0]?.pid);
    expect(afterCommit[0]?.organization_id).toBeNull();
  });

  it("clears tenant context after rollback on a reused pooled connection", async () => {
    let transactionPid: number | undefined;

    await expect(
      withTenantTransaction(
        lifecycle.client,
        organizationB,
        async (transaction) => {
          const rows = await transaction.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `;
          transactionPid = rows[0]?.pid;
          throw new Error("forced rollback");
        },
      ),
    ).rejects.toThrow("forced rollback");

    const afterRollback = await lifecycle.client.$queryRaw<
      Array<{ organization_id: string | null; pid: number }>
    >`
      SELECT
        nullif(current_setting('bcm.current_organization_id', true), '') AS organization_id,
        pg_backend_pid() AS pid
    `;

    expect(afterRollback[0]?.pid).toBe(transactionPid);
    expect(afterRollback[0]?.organization_id).toBeNull();
  });
});
