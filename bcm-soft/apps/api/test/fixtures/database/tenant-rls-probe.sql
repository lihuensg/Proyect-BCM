CREATE TABLE test_tenant_fk_parents (
  id uuid NOT NULL,
  organization_id uuid NOT NULL,
  CONSTRAINT pk_test_tenant_fk_parents PRIMARY KEY (id),
  CONSTRAINT uq_test_tenant_fk_parents__organization_id_id
    UNIQUE (organization_id, id)
);

CREATE TABLE test_tenant_rls_probe (
  id uuid NOT NULL,
  organization_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  probe_value text NOT NULL,
  CONSTRAINT pk_test_tenant_rls_probe PRIMARY KEY (id),
  CONSTRAINT fk_test_tenant_rls_probe__tenant_parent
    FOREIGN KEY (organization_id, parent_id)
    REFERENCES test_tenant_fk_parents (organization_id, id)
);

CREATE INDEX ix_test_tenant_rls_probe__organization_id__id
  ON test_tenant_rls_probe (organization_id, id);

INSERT INTO test_tenant_fk_parents (id, organization_id)
VALUES
  ('0198d5a0-0002-7000-8000-000000000001', '0198d5a0-0000-7000-8000-000000000001'),
  ('0198d5a0-0002-7000-8000-000000000002', '0198d5a0-0000-7000-8000-000000000002');

INSERT INTO test_tenant_rls_probe (id, organization_id, parent_id, probe_value)
VALUES
  ('0198d5a0-0001-7000-8000-000000000001', '0198d5a0-0000-7000-8000-000000000001', '0198d5a0-0002-7000-8000-000000000001', 'tenant-a'),
  ('0198d5a0-0001-7000-8000-000000000002', '0198d5a0-0000-7000-8000-000000000002', '0198d5a0-0002-7000-8000-000000000002', 'tenant-b');

REVOKE ALL PRIVILEGES ON TABLE test_tenant_fk_parents FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE test_tenant_rls_probe FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE test_tenant_rls_probe FROM bcm_soft_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE test_tenant_rls_probe TO bcm_soft_runtime;

ALTER TABLE test_tenant_rls_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_tenant_rls_probe FORCE ROW LEVEL SECURITY;

CREATE POLICY test_tenant_rls_probe__tenant_isolation
  ON test_tenant_rls_probe
  TO bcm_soft_runtime
  USING (
    organization_id::text = current_setting('bcm.current_organization_id', true)
  )
  WITH CHECK (
    organization_id::text = current_setting('bcm.current_organization_id', true)
  );
