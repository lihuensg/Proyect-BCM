\set ON_ERROR_STOP on

\getenv database_name POSTGRES_DB
\getenv migration_password BCM_MIGRATION_PASSWORD
\getenv migration_role BCM_MIGRATION_ROLE
\getenv postgres_role POSTGRES_USER
\getenv runtime_password BCM_RUNTIME_PASSWORD
\getenv runtime_role BCM_RUNTIME_ROLE
\getenv shadow_database BCM_SHADOW_DATABASE

SELECT format('CREATE ROLE %I', :'migration_role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'migration_role')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT',
  :'migration_role',
  :'migration_password'
)
\gexec

DO $provision$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bcm_soft_runtime') THEN
    CREATE ROLE bcm_soft_runtime;
  END IF;
END
$provision$;

ALTER ROLE bcm_soft_runtime
  WITH NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;

SELECT format('CREATE ROLE %I', :'runtime_role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT',
  :'runtime_role',
  :'runtime_password'
)
\gexec

SELECT format('GRANT bcm_soft_runtime TO %I', :'runtime_role')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'shadow_database', :'migration_role')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'shadow_database')
\gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'shadow_database')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'shadow_database', :'migration_role')
\gexec

SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'database_name')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'postgres_role')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'migration_role')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'runtime_role')
\gexec

SELECT format('ALTER SCHEMA public OWNER TO %I', :'migration_role')
\gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bcm_soft_runtime;
