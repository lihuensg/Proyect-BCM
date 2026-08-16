# Local PostgreSQL foundation

## Purpose

This Compose file runs only the PostgreSQL service required for local development and database integration tests. It does not containerize the API or Web application and is not production infrastructure.

PostgreSQL is pinned to `18.4-alpine3.24` and its reviewed multi-platform image digest. The service binds only to loopback. Local data uses a named Compose volume; the automated test workflow uses a unique Compose project and removes its container, network, and volume after every run.

## Local development

1. Copy `.env.example` to `.env` in this directory.
2. Replace the placeholder password with a random local-only value.
3. Start PostgreSQL with `pnpm --filter @bcm-soft/api db:local:up`.
4. Export both server-only URLs before running API or Prisma commands:

   ```text
   DATABASE_URL=postgresql://bcm_local_migration:<password>@127.0.0.1:55432/bcm_soft_local?application_name=bcm-soft-local
   DIRECT_DATABASE_URL=postgresql://bcm_local_migration:<password>@127.0.0.1:55432/bcm_soft_local?application_name=bcm-soft-migration
   ```

5. Generate a reviewed migration in development with `pnpm --filter @bcm-soft/api db:migrate:dev -- --name <migration-name>`.
6. Stop the local service with `pnpm --filter @bcm-soft/api db:local:down`.

The shared local credential is a temporary foundation limitation. Production-like runtime and migration roles remain separate and are implemented and proven in BCM-DB-004. Never reuse these synthetic local values outside local development.

## Migration workflow

- Development creates and applies reviewed migrations through `db:migrate:dev`.
- Test, staging, and production-like environments apply committed history through `db:migrate:deploy`.
- `db:migrate:status` inspects migration state.
- Migrations are forward-only and must never be edited after application.
- Direct schema synchronization shortcuts are not part of the migration workflow.

BCM-DB-001 and BCM-DB-002 intentionally have no SQL migration or application model. BCM-DB-002 proves database primitives with integration-only fixtures in ephemeral PostgreSQL and verifies `migrate deploy` plus `migrate status` with zero durable migrations. The first durable migration and real product tables belong to BCM-DB-003.

## Test isolation and cleanup

`pnpm --filter @bcm-soft/api test:db` generates a unique project, database, user, and password in memory. It starts PostgreSQL on a random loopback port, applies the complete migration history, runs the database integration suite serially, and removes the isolated Compose resources in a guarded `finally` block.

Cleanup rejects non-test environments, non-loopback URLs, unexpected database/user names, missing test markers, short passwords, and unrelated Compose project names. No real credential or `.env` file is committed.
