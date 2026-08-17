CREATE TABLE test_primitive_parents (
  id uuid NOT NULL,
  CONSTRAINT pk_test_primitive_parents PRIMARY KEY (id)
);

CREATE TABLE test_database_primitives (
  id uuid NOT NULL,
  parent_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  money_amount numeric(19,2) NOT NULL,
  exchange_rate numeric(20,8) NOT NULL,
  intermediate_amount numeric(38,12) NOT NULL,
  reference_normalized text NOT NULL,
  active_code_normalized text,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_test_database_primitives PRIMARY KEY (id),
  CONSTRAINT fk_test_database_primitives__parent_id__test_primitive_parents
    FOREIGN KEY (parent_id) REFERENCES test_primitive_parents (id),
  CONSTRAINT uq_test_database_primitives__reference_normalized
    UNIQUE (reference_normalized),
  CONSTRAINT ck_test_database_primitives__money_amount_nonnegative
    CHECK (money_amount >= 0)
);

CREATE INDEX ix_test_database_primitives__created_at
  ON test_database_primitives (created_at);

CREATE UNIQUE INDEX ux_test_database_primitives__active_code_normalized__active
  ON test_database_primitives (active_code_normalized)
  WHERE is_active;

REVOKE ALL PRIVILEGES ON TABLE test_primitive_parents FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE test_database_primitives FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  test_primitive_parents,
  test_database_primitives
TO bcm_soft_runtime;
