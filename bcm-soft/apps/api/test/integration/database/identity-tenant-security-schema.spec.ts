import { randomBytes } from "node:crypto";

import { Client, DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertSafeTestDatabaseTarget } from "../../../src/infrastructure/database/test-database-target.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";

const expectedTables = [
  "identity_rate_limit_windows",
  "organization_invitations",
  "organization_memberships",
  "organizations",
  "password_recovery_tokens",
  "sessions",
  "user_password_credentials",
  "users",
];

const expectedConstraints = [
  "ck_identity_rate_limit_windows__attempt_count",
  "ck_identity_rate_limit_windows__dimension",
  "ck_identity_rate_limit_windows__fingerprint_version",
  "ck_identity_rate_limit_windows__lifecycle",
  "ck_identity_rate_limit_windows__operation",
  "ck_organization_invitations__email_nonempty",
  "ck_organization_invitations__intended_role",
  "ck_organization_invitations__lifecycle",
  "ck_organization_invitations__token_hash_length",
  "ck_organization_memberships__authorization_version",
  "ck_organization_memberships__lifecycle",
  "ck_organization_memberships__role",
  "ck_organization_memberships__status",
  "ck_organizations__name_nonempty",
  "ck_organizations__status",
  "ck_organizations__timestamps",
  "ck_password_recovery_tokens__lifecycle",
  "ck_password_recovery_tokens__token_hash_length",
  "ck_sessions__current_membership_context",
  "ck_sessions__lifecycle",
  "ck_sessions__token_hash_length",
  "ck_user_password_credentials__password_hash_nonempty",
  "ck_user_password_credentials__timestamps",
  "ck_users__email_nonempty",
  "ck_users__email_normalized_nonempty",
  "ck_users__status",
  "ck_users__timestamps",
  "fk_organization_invitations__accepted_by_user_id__users",
  "fk_organization_invitations__invited_by_user_id__users",
  "fk_organization_invitations__organization_id__organizations",
  "fk_organization_memberships__organization_id__organizations",
  "fk_organization_memberships__user_id__users",
  "fk_password_recovery_tokens__user_id__users",
  "fk_sessions__current_membership__organization_memberships",
  "fk_sessions__user_id__users",
  "fk_user_password_credentials__user_id__users",
  "pk_identity_rate_limit_windows",
  "pk_organization_invitations",
  "pk_organization_memberships",
  "pk_organizations",
  "pk_password_recovery_tokens",
  "pk_sessions",
  "pk_user_password_credentials",
  "pk_users",
  "uq_identity_rate_limit_windows__logical_window",
  "uq_organization_memberships__organization_id_user_id",
  "uq_organization_invitations__token_hash",
  "uq_password_recovery_tokens__token_hash",
  "uq_sessions__token_hash",
  "uq_users__email_normalized",
];

const expectedIndexes = [
  "ix_identity_rate_limit_windows__expires_at",
  "ix_organization_invitations__accepted_by_user_id",
  "ix_organization_invitations__expires_at",
  "ix_organization_invitations__invited_by_user_id",
  "ix_organization_invitations__organization_created_at_id",
  "ix_organization_invitations__organization_email_lifecycle",
  "ix_organization_memberships__user_id_status",
  "ix_password_recovery_tokens__expires_at",
  "ix_password_recovery_tokens__user_id_created_at",
  "ix_sessions__current_organization_id_user_id",
  "ix_sessions__expires_at",
  "ix_sessions__user_id_revoked_at",
  "ux_organization_invitations__pending_email",
];

describe("identity and tenant security persistence foundation", () => {
  const sqlClient = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });

  beforeAll(async () => {
    assertSafeTestDatabaseTarget(
      process.env.DIRECT_DATABASE_URL ?? "",
      process.env.NODE_ENV,
    );
    await sqlClient.connect();
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  async function expectConstraintViolation(
    text: string,
    values: readonly unknown[],
    constraint: string,
  ): Promise<void> {
    try {
      await sqlClient.query(text, [...values]);
      throw new Error(`Expected constraint ${constraint} to reject the query.`);
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).constraint).toBe(constraint);
    }
  }

  async function insertOrganization(
    name = "BCM Test Organization",
  ): Promise<string> {
    const id = generateUuidV7();
    await sqlClient.query(
      `INSERT INTO organizations
        (id, name, status, timezone, created_at, updated_at)
       VALUES ($1::uuid, $2, 'Active', 'America/Argentina/Buenos_Aires', now(), now())`,
      [id, name],
    );
    return id;
  }

  async function insertUser(emailNormalized?: string): Promise<string> {
    const id = generateUuidV7();
    const normalized = emailNormalized ?? `user-${id}@example.test`;
    await sqlClient.query(
      `INSERT INTO users
        (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, 'Active', now(), now())`,
      [id, normalized.toUpperCase(), normalized],
    );
    return id;
  }

  async function insertMembership(
    organizationId: string,
    userId: string,
  ): Promise<string> {
    const id = generateUuidV7();
    await sqlClient.query(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, activated_at, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Owner', 'Active', now(), now(), now())`,
      [id, organizationId, userId],
    );
    return id;
  }

  it("materializes exactly the eight approved tables, physical types, constraints, and indexes", async () => {
    const tables = await sqlClient.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
        AND table_name NOT LIKE 'test\\_%' ESCAPE '\\'
      ORDER BY table_name
    `);
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
      expectedTables,
    );

    const columns = await sqlClient.query<{
      column_name: string;
      data_type: string;
      datetime_precision: number | null;
      table_name: string;
    }>(
      `
      SELECT table_name, column_name, data_type, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
    `,
      [expectedTables],
    );
    expect(
      columns.rows
        .filter(({ data_type }) => data_type === "timestamp with time zone")
        .every(({ datetime_precision }) => datetime_precision === 3),
    ).toBe(true);
    expect(
      columns.rows.some(
        ({ data_type }) => data_type === "timestamp without time zone",
      ),
    ).toBe(false);
    expect(
      columns.rows.some(({ data_type }) =>
        ["numeric", "real", "double precision"].includes(data_type),
      ),
    ).toBe(false);
    expect(
      columns.rows
        .filter(({ column_name }) => column_name === "token_hash")
        .every(({ data_type }) => data_type === "bytea"),
    ).toBe(true);

    const constraints = await sqlClient.query<{ conname: string }>(
      `
      SELECT conname
      FROM pg_constraint
      WHERE connamespace = current_schema()::regnamespace
        AND conrelid::regclass::text = ANY($1::text[])
      ORDER BY conname
    `,
      [expectedTables],
    );
    expect(constraints.rows.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining(expectedConstraints),
    );

    const indexes = await sqlClient.query<{ indexname: string }>(
      `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = ANY($1::text[])
      ORDER BY indexname
    `,
      [expectedTables],
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining(expectedIndexes),
    );

    const limiterColumns = columns.rows
      .filter(({ table_name }) => table_name === "identity_rate_limit_windows")
      .map(({ column_name }) => column_name);
    expect(limiterColumns).not.toEqual(
      expect.arrayContaining(["email", "ip", "user_agent"]),
    );
  });

  it("stores application-owned UUIDv7 identifiers and enforces global normalized email uniqueness", async () => {
    const normalized = `identity-${generateUuidV7()}@example.test`;
    const userId = await insertUser(normalized);
    expect(userId[14]).toBe("7");

    const result = await sqlClient.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1::uuid",
      [userId],
    );
    expect(result.rows).toEqual([{ id: userId }]);

    await expectConstraintViolation(
      `INSERT INTO users
        (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, 'Active', now(), now())`,
      [generateUuidV7(), normalized.toUpperCase(), normalized],
      "uq_users__email_normalized",
    );
  });

  it("enforces Membership uniqueness, approved values, positive version, and multi-organization membership", async () => {
    const userId = await insertUser();
    const firstOrganizationId = await insertOrganization();
    const secondOrganizationId = await insertOrganization();
    await insertMembership(firstOrganizationId, userId);
    await insertMembership(secondOrganizationId, userId);

    await expectConstraintViolation(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Owner', 'Active', now(), now())`,
      [generateUuidV7(), firstOrganizationId, userId],
      "uq_organization_memberships__organization_id_user_id",
    );

    const anotherUserId = await insertUser();
    await expectConstraintViolation(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Manager', 'Active', now(), now())`,
      [generateUuidV7(), firstOrganizationId, anotherUserId],
      "ck_organization_memberships__role",
    );
    await expectConstraintViolation(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Viewer', 'Pending', now(), now())`,
      [generateUuidV7(), firstOrganizationId, anotherUserId],
      "ck_organization_memberships__status",
    );
    await expectConstraintViolation(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, authorization_version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Viewer', 'Active', 0, now(), now())`,
      [generateUuidV7(), firstOrganizationId, anotherUserId],
      "ck_organization_memberships__authorization_version",
    );
  });

  it("enforces one password credential per User without implementing password behavior", async () => {
    const userId = await insertUser();
    const insertCredential = `INSERT INTO user_password_credentials
      (user_id, password_hash, password_changed_at, created_at, updated_at)
      VALUES ($1::uuid, '$phc$synthetic$credential-hash', now(), now(), now())`;
    await sqlClient.query(insertCredential, [userId]);

    await expectConstraintViolation(
      insertCredential,
      [userId],
      "pk_user_password_credentials",
    );
    await expectConstraintViolation(
      insertCredential,
      [generateUuidV7()],
      "fk_user_password_credentials__user_id__users",
    );
  });

  it("enforces Session digest, lifecycle, context coherence, and structural Membership", async () => {
    const userId = await insertUser();
    const organizationId = await insertOrganization();
    await insertMembership(organizationId, userId);
    const tokenHash = randomBytes(32);
    const insertSession = `INSERT INTO sessions
      (id, token_hash, user_id, current_organization_id,
       current_membership_authorization_version, expires_at, created_at)
      VALUES ($1::uuid, $2, $3::uuid, $4::uuid, 1, now() + interval '1 hour', now())`;
    await sqlClient.query(insertSession, [
      generateUuidV7(),
      tokenHash,
      userId,
      organizationId,
    ]);

    await expectConstraintViolation(
      insertSession,
      [generateUuidV7(), tokenHash, userId, organizationId],
      "uq_sessions__token_hash",
    );
    const unrelatedOrganizationId = await insertOrganization();
    await expectConstraintViolation(
      insertSession,
      [generateUuidV7(), randomBytes(32), userId, unrelatedOrganizationId],
      "fk_sessions__current_membership__organization_memberships",
    );
    await expectConstraintViolation(
      `INSERT INTO sessions
        (id, token_hash, user_id, current_organization_id, expires_at, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, now() + interval '1 hour', now())`,
      [generateUuidV7(), randomBytes(32), userId, organizationId],
      "ck_sessions__current_membership_context",
    );
    await expectConstraintViolation(
      `INSERT INTO sessions
        (id, token_hash, user_id, expires_at, created_at)
       VALUES ($1::uuid, $2, $3::uuid, now() - interval '1 second', now())`,
      [generateUuidV7(), randomBytes(32), userId],
      "ck_sessions__lifecycle",
    );
  });

  it("enforces one-time recovery digest and terminal lifecycle", async () => {
    const userId = await insertUser();
    const tokenHash = randomBytes(32);
    const insertRecovery = `INSERT INTO password_recovery_tokens
      (id, user_id, token_hash, expires_at, created_at)
      VALUES ($1::uuid, $2::uuid, $3, now() + interval '1 hour', now())`;
    await sqlClient.query(insertRecovery, [
      generateUuidV7(),
      userId,
      tokenHash,
    ]);

    await expectConstraintViolation(
      insertRecovery,
      [generateUuidV7(), userId, tokenHash],
      "uq_password_recovery_tokens__token_hash",
    );
    await expectConstraintViolation(
      `INSERT INTO password_recovery_tokens
        (id, user_id, token_hash, expires_at, used_at, revoked_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3, now() + interval '1 hour', now(), now(), now())`,
      [generateUuidV7(), userId, randomBytes(32)],
      "ck_password_recovery_tokens__lifecycle",
    );
  });

  it("enforces invitation digest, scoped pending uniqueness, and terminal lifecycle", async () => {
    const inviterId = await insertUser();
    const firstOrganizationId = await insertOrganization();
    const secondOrganizationId = await insertOrganization();
    const normalized = `invite-${generateUuidV7()}@example.test`;
    const tokenHash = randomBytes(32);
    const insertInvitation = `INSERT INTO organization_invitations
      (id, organization_id, intended_email, intended_email_normalized,
       intended_role, token_hash, invited_by_user_id, expires_at, created_at, updated_at)
      VALUES ($1::uuid, $2::uuid, $3, $3, 'Seller', $4, $5::uuid,
              now() + interval '1 day', now(), now())`;
    await sqlClient.query(insertInvitation, [
      generateUuidV7(),
      firstOrganizationId,
      normalized,
      tokenHash,
      inviterId,
    ]);

    await expectConstraintViolation(
      insertInvitation,
      [
        generateUuidV7(),
        firstOrganizationId,
        normalized,
        randomBytes(32),
        inviterId,
      ],
      "ux_organization_invitations__pending_email",
    );
    await sqlClient.query(insertInvitation, [
      generateUuidV7(),
      secondOrganizationId,
      normalized,
      randomBytes(32),
      inviterId,
    ]);
    await expectConstraintViolation(
      insertInvitation,
      [
        generateUuidV7(),
        secondOrganizationId,
        `other-${normalized}`,
        tokenHash,
        inviterId,
      ],
      "uq_organization_invitations__token_hash",
    );
    await expectConstraintViolation(
      `INSERT INTO organization_invitations
        (id, organization_id, intended_email, intended_email_normalized,
         intended_role, token_hash, invited_by_user_id, expires_at,
         accepted_at, revoked_at, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $3, 'Viewer', $4, $5::uuid,
               now() + interval '1 day', now(), now(), now(), now())`,
      [
        generateUuidV7(),
        firstOrganizationId,
        `terminal-${normalized}`,
        randomBytes(32),
        inviterId,
      ],
      "ck_organization_invitations__lifecycle",
    );
  });

  it("enforces logical identity rate-limit windows without raw PII", async () => {
    const fingerprint = randomBytes(32);
    const windowStartedAt = new Date();
    const insertWindow = `INSERT INTO identity_rate_limit_windows
      (id, operation, dimension, key_fingerprint, fingerprint_version,
       window_started_at, expires_at, attempt_count, created_at, updated_at)
      VALUES ($1::uuid, $2, 'Identity', $3, 1, $4,
              $4::timestamptz + interval '15 minutes', $5, now(), now())`;
    await sqlClient.query(insertWindow, [
      generateUuidV7(),
      "Login",
      fingerprint,
      windowStartedAt,
      1,
    ]);

    await expectConstraintViolation(
      insertWindow,
      [generateUuidV7(), "Login", fingerprint, windowStartedAt, 2],
      "uq_identity_rate_limit_windows__logical_window",
    );
    await expectConstraintViolation(
      insertWindow,
      [generateUuidV7(), "PasswordRecovery", randomBytes(32), new Date(), -1],
      "ck_identity_rate_limit_windows__attempt_count",
    );
    await expectConstraintViolation(
      insertWindow,
      [generateUuidV7(), "Signup", randomBytes(32), new Date(), 1],
      "ck_identity_rate_limit_windows__operation",
    );
  });
});
