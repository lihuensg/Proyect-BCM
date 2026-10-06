-- BCM-DB-004: the stable NOLOGIN capability role is provisioned before Prisma.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM bcm_soft_runtime;
GRANT USAGE ON SCHEMA public TO bcm_soft_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM bcm_soft_runtime;

-- INSERT serves only the one-time initial setup, which creates the first
-- Organization under an advisory lock while none exists. No UPDATE or DELETE.
GRANT SELECT, INSERT ON TABLE organizations TO bcm_soft_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE
  users,
  organization_memberships
TO bcm_soft_runtime;

-- External identity links are immutable to the runtime role.
GRANT SELECT, INSERT ON TABLE user_external_identities TO bcm_soft_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  sessions,
  organization_invitations
TO bcm_soft_runtime;
