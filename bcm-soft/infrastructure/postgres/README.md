# Local PostgreSQL foundation

## Purpose

This Compose file runs only the PostgreSQL service required for local development and database integration tests. It does not containerize the API or Web application and is not production infrastructure.

PostgreSQL is pinned to `18.4-alpine3.24` and its reviewed multi-platform image digest. The service binds only to loopback. Local data uses a named Compose volume; the automated test workflow uses a unique Compose project and removes its container, network, and volume after every run.

## Local development

1. Copy `.env.example` to `.env` in this directory.
2. Replace all placeholder passwords with distinct random local-only values.
3. Start PostgreSQL with `pnpm --filter @bcm-soft/api db:local:up`.
4. Export the separate server-only URLs before running API or Prisma commands:

   ```text
   DATABASE_URL=postgresql://bcm_local_runtime:<runtime-password>@127.0.0.1:55432/bcm_soft_local?application_name=bcm-soft-local
   DIRECT_DATABASE_URL=postgresql://bcm_local_migration:<migration-password>@127.0.0.1:55432/bcm_soft_local?application_name=bcm-soft-migration
   SHADOW_DATABASE_URL=postgresql://bcm_local_migration:<migration-password>@127.0.0.1:55432/bcm_soft_local_shadow?application_name=bcm-soft-shadow
   ```

5. Generate a reviewed migration in development with `pnpm --filter @bcm-soft/api db:migrate:dev -- --name <migration-name>`.
6. Stop the local service with `pnpm --filter @bcm-soft/api db:local:down`.

Never reuse these synthetic local values outside local development. The bootstrap/admin URL is infrastructure-only and must not be supplied to the API, Prisma commands, application configuration, or logs.

## Database identities and privileges

The container bootstrap provisions four distinct identity levels before Prisma runs:

- the environment-specific `POSTGRES_USER` bootstrap/admin login owns the database and is used only by infrastructure provisioning;
- the environment-specific migration login owns the `public` schema and every durable Prisma object;
- the disposable local shadow database is owned by the migration login so `migrate dev` works without `CREATEDB`;
- `bcm_soft_runtime` is a stable `NOLOGIN` capability role referenced by reviewed migrations;
- the environment-specific runtime login inherits only `bcm_soft_runtime` and is used by the API.

Migration and runtime roles are explicitly `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, and `NOREPLICATION`. Migration and capability roles are `NOINHERIT`; the runtime login alone is `INHERIT` so it receives the reviewed capability ACL. Runtime receives schema `USAGE` and explicit table-level DML only. It receives no schema `CREATE`, table ownership, migration metadata access, `TRUNCATE`, `REFERENCES`, `TRIGGER`, or DDL capability. PostgreSQL's `PUBLIC` role receives neither database `CONNECT` nor schema `CREATE` from this foundation.

The provisioning script is idempotent and intentionally lives outside Prisma because role creation and database-level access precede migrations. It reads credentials from process/container environment only. For credential rotation or repair, an authorized operator updates the environment secrets and reruns `provision-roles.sql` as the bootstrap/admin identity against the intended database, then verifies migration connectivity and runtime denial before withdrawing the old secret. Do not place passwords on command lines, in committed files, or in captured logs.

The durable runtime grant matrix is intentionally explicit:

| Table | Runtime operations |
| --- | --- |
| `organizations` | `SELECT` |
| `users` | `SELECT`, `INSERT`, `UPDATE` |
| `user_password_credentials` | `SELECT`, `INSERT`, `UPDATE` |
| `organization_memberships` | `SELECT`, `INSERT`, `UPDATE` |
| `sessions` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `password_recovery_tokens` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `organization_invitations` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `identity_rate_limit_windows` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |

Managed PostgreSQL must apply the equivalent provider-supported role provisioning before Prisma Migrate. The local init mount is not production infrastructure and no application process receives the provider bootstrap identity.

## Migration workflow

- Development creates and applies reviewed migrations through `db:migrate:dev`.
- Test, staging, and production-like environments apply committed history through `db:migrate:deploy`.
- `db:migrate:status` inspects migration state.
- Migrations are forward-only and must never be edited after application.
- Direct schema synchronization shortcuts are not part of the migration workflow.
- `DIRECT_DATABASE_URL` must identify the migration login; `DATABASE_URL` and `TEST_DATABASE_URL` must identify the runtime login.
- Runtime must never run Prisma migration commands. CI proves that a runtime migration attempt is denied.

BCM-DB-001 and BCM-DB-002 intentionally have no SQL migration or application model. BCM-DB-002 proves database primitives with integration-only fixtures in ephemeral PostgreSQL. BCM-DB-003 owns the first durable identity/tenant migration. BCM-DB-004 adds only forward-only runtime ACL hardening; its RLS probe remains test-only and does not alter the eight identity tables.

## Test isolation and cleanup

`pnpm --filter @bcm-soft/api test:db` generates a unique project, primary/upgrade/shadow databases, three login roles, and distinct passwords in memory. It starts PostgreSQL on a random loopback port, provisions roles, proves both empty-to-latest and BCM-DB-003-to-BCM-DB-004 migration paths, verifies runtime migration denial, creates test-only database and RLS fixtures with the migration identity, and runs the database integration suite serially as runtime. It removes the isolated Compose containers, network, and volume in a guarded `finally` block.

The RLS feasibility probe sets `bcm.current_organization_id` through a parameterized `set_config(..., true)` inside a Prisma interactive transaction. The callback receives only the transaction client. The policy is fail-closed when context is missing and uses both `USING` and `WITH CHECK`; the probe table has both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Production tenant tables and policies remain out of scope until BCM-TEN-003.

## Recovery

Applied migrations remain immutable and no automatic down migration is provided. If DB-004 grants are incorrect, stop the affected rollout, preserve evidence, and ship a reviewed forward-fix migration that restores the explicit matrix. An emergency ACL correction may be executed by an authorized migration/bootstrap operator under change control, but must be reconciled immediately into reviewed migration history. Roll back the application artifact only when its database compatibility has been verified. For a future destructive or corrupting production incident, use the provider's tested point-in-time recovery or restore procedure rather than improvising destructive SQL; backup/PITR infrastructure itself remains a later deployment responsibility.

Cleanup rejects non-test environments, non-loopback URLs, unexpected database/user names, missing test markers, short passwords, and unrelated Compose project names. No real credential or `.env` file is committed.
