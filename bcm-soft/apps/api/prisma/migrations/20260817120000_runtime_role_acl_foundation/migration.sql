-- BCM-DB-004: the stable NOLOGIN capability role is provisioned before Prisma.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM bcm_soft_runtime;
GRANT USAGE ON SCHEMA public TO bcm_soft_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM bcm_soft_runtime;

GRANT SELECT ON TABLE organizations TO bcm_soft_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE
  users,
  user_password_credentials,
  organization_memberships
TO bcm_soft_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  sessions,
  password_recovery_tokens,
  organization_invitations,
  identity_rate_limit_windows
TO bcm_soft_runtime;
