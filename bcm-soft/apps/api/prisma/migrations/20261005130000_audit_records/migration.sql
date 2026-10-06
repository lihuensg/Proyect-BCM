-- DATABASE.md §35 / SECURITY.md §40: tenant-owned, append-only Audit Records.
-- Every current event belongs to one Organization; a system-scope variant
-- (nullable organization_id) is a later forward migration when one exists.
CREATE TABLE "audit_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "correlation_id" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_audit_records" PRIMARY KEY ("id"),
    CONSTRAINT "ck_audit_records__action" CHECK ("action" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' AND length("action") <= 100),
    CONSTRAINT "ck_audit_records__entity_type" CHECK ("entity_type" ~ '^[A-Z][A-Za-z]*$' AND length("entity_type") <= 100),
    CONSTRAINT "ck_audit_records__before_object" CHECK ("before" IS NULL OR jsonb_typeof("before") = 'object'),
    CONSTRAINT "ck_audit_records__after_object" CHECK ("after" IS NULL OR jsonb_typeof("after") = 'object'),
    CONSTRAINT "ck_audit_records__reason_length" CHECK ("reason" IS NULL OR length("reason") BETWEEN 1 AND 1000),
    CONSTRAINT "ck_audit_records__correlation_id_length" CHECK ("correlation_id" IS NULL OR length("correlation_id") BETWEEN 1 AND 128)
);

CREATE INDEX "ix_audit_records__organization_occurred_at_id"
ON "audit_records"("organization_id", "occurred_at" DESC, "id" DESC);

CREATE INDEX "ix_audit_records__actor_user_id"
ON "audit_records"("actor_user_id");

ALTER TABLE "audit_records"
ADD CONSTRAINT "fk_audit_records__organization_id__organizations"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DATABASE.md §40: SET NULL only for an optional actor whose fact outlives it.
ALTER TABLE "audit_records"
ADD CONSTRAINT "fk_audit_records__actor_user_id__users"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only for the runtime role. SELECT is granted with the future
-- `audit.read` capability, not before a reader exists.
REVOKE ALL PRIVILEGES ON TABLE "audit_records" FROM PUBLIC;
GRANT INSERT ON TABLE "audit_records" TO bcm_soft_runtime;

-- SECURITY.md §19-20: transaction-local tenant context, fail-closed.
ALTER TABLE "audit_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_records" FORCE ROW LEVEL SECURITY;

CREATE POLICY "audit_records__tenant_isolation"
ON "audit_records"
TO bcm_soft_runtime
USING ("organization_id"::text = current_setting('bcm.current_organization_id', true))
WITH CHECK ("organization_id"::text = current_setting('bcm.current_organization_id', true));
