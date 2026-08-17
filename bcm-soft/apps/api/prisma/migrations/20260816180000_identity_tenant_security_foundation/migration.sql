CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_organizations" PRIMARY KEY ("id"),
    CONSTRAINT "ck_organizations__name_nonempty" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "ck_organizations__status" CHECK ("status" IN ('Active', 'Inactive')),
    CONSTRAINT "ck_organizations__timestamps" CHECK ("updated_at" >= "created_at")
);

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_users" PRIMARY KEY ("id"),
    CONSTRAINT "ck_users__email_nonempty" CHECK (length(btrim("email")) > 0),
    CONSTRAINT "ck_users__email_normalized_nonempty" CHECK (length("email_normalized") > 0),
    CONSTRAINT "ck_users__status" CHECK ("status" IN ('Active', 'Disabled')),
    CONSTRAINT "ck_users__timestamps" CHECK ("updated_at" >= "created_at"),
    CONSTRAINT "uq_users__email_normalized" UNIQUE ("email_normalized")
);

CREATE TABLE "user_password_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_user_password_credentials" PRIMARY KEY ("user_id"),
    CONSTRAINT "ck_user_password_credentials__password_hash_nonempty" CHECK (length("password_hash") > 0),
    CONSTRAINT "ck_user_password_credentials__timestamps" CHECK (
        "password_changed_at" >= "created_at" AND "updated_at" >= "created_at"
    )
);

CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "authorization_version" BIGINT NOT NULL DEFAULT 1,
    "activated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_organization_memberships" PRIMARY KEY ("id"),
    CONSTRAINT "ck_organization_memberships__role" CHECK ("role" IN ('Owner', 'Admin', 'Seller', 'Viewer')),
    CONSTRAINT "ck_organization_memberships__status" CHECK ("status" IN ('Active', 'Suspended', 'Revoked')),
    CONSTRAINT "ck_organization_memberships__authorization_version" CHECK ("authorization_version" >= 1),
    CONSTRAINT "ck_organization_memberships__lifecycle" CHECK (
        ("activated_at" IS NULL OR "activated_at" >= "created_at")
        AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
        AND (("status" = 'Revoked') = ("revoked_at" IS NOT NULL))
        AND "updated_at" >= "created_at"
    ),
    CONSTRAINT "uq_organization_memberships__organization_id_user_id" UNIQUE ("organization_id", "user_id")
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "current_organization_id" UUID,
    "current_membership_authorization_version" BIGINT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_sessions" PRIMARY KEY ("id"),
    CONSTRAINT "ck_sessions__token_hash_length" CHECK (octet_length("token_hash") = 32),
    CONSTRAINT "ck_sessions__lifecycle" CHECK (
        "expires_at" > "created_at"
        AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
        AND ("last_seen_at" IS NULL OR "last_seen_at" >= "created_at")
    ),
    CONSTRAINT "ck_sessions__current_membership_context" CHECK (
        ("current_organization_id" IS NULL) = ("current_membership_authorization_version" IS NULL)
        AND ("current_membership_authorization_version" IS NULL OR "current_membership_authorization_version" >= 1)
    ),
    CONSTRAINT "uq_sessions__token_hash" UNIQUE ("token_hash")
);

CREATE TABLE "password_recovery_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_password_recovery_tokens" PRIMARY KEY ("id"),
    CONSTRAINT "ck_password_recovery_tokens__token_hash_length" CHECK (octet_length("token_hash") = 32),
    CONSTRAINT "ck_password_recovery_tokens__lifecycle" CHECK (
        "expires_at" > "created_at"
        AND ("used_at" IS NULL OR "used_at" >= "created_at")
        AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
        AND NOT ("used_at" IS NOT NULL AND "revoked_at" IS NOT NULL)
    ),
    CONSTRAINT "uq_password_recovery_tokens__token_hash" UNIQUE ("token_hash")
);

CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "intended_email" TEXT NOT NULL,
    "intended_email_normalized" TEXT NOT NULL,
    "intended_role" TEXT NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "accepted_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_organization_invitations" PRIMARY KEY ("id"),
    CONSTRAINT "ck_organization_invitations__email_nonempty" CHECK (
        length(btrim("intended_email")) > 0 AND length("intended_email_normalized") > 0
    ),
    CONSTRAINT "ck_organization_invitations__intended_role" CHECK ("intended_role" IN ('Owner', 'Admin', 'Seller', 'Viewer')),
    CONSTRAINT "ck_organization_invitations__token_hash_length" CHECK (octet_length("token_hash") = 32),
    CONSTRAINT "ck_organization_invitations__lifecycle" CHECK (
        "expires_at" > "created_at"
        AND ("accepted_at" IS NULL OR "accepted_at" >= "created_at")
        AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
        AND NOT ("accepted_at" IS NOT NULL AND "revoked_at" IS NOT NULL)
        AND "updated_at" >= "created_at"
    ),
    CONSTRAINT "uq_organization_invitations__token_hash" UNIQUE ("token_hash")
);

CREATE TABLE "identity_rate_limit_windows" (
    "id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key_fingerprint" BYTEA NOT NULL,
    "fingerprint_version" INTEGER NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_identity_rate_limit_windows" PRIMARY KEY ("id"),
    CONSTRAINT "ck_identity_rate_limit_windows__operation" CHECK ("operation" IN ('Login', 'PasswordRecovery', 'Invitation')),
    CONSTRAINT "ck_identity_rate_limit_windows__dimension" CHECK ("dimension" IN ('Identity', 'Network', 'IdentityNetwork')),
    CONSTRAINT "ck_identity_rate_limit_windows__fingerprint_version" CHECK ("fingerprint_version" >= 1),
    CONSTRAINT "ck_identity_rate_limit_windows__attempt_count" CHECK ("attempt_count" >= 0),
    CONSTRAINT "ck_identity_rate_limit_windows__lifecycle" CHECK (
        octet_length("key_fingerprint") > 0
        AND "expires_at" > "window_started_at"
        AND ("blocked_until" IS NULL OR "blocked_until" > "window_started_at")
        AND "updated_at" >= "created_at"
    ),
    CONSTRAINT "uq_identity_rate_limit_windows__logical_window" UNIQUE ("operation", "dimension", "key_fingerprint", "window_started_at")
);

CREATE INDEX "ix_organization_memberships__user_id_status"
ON "organization_memberships" ("user_id", "status");

CREATE INDEX "ix_sessions__user_id_revoked_at"
ON "sessions" ("user_id", "revoked_at");

CREATE INDEX "ix_sessions__expires_at"
ON "sessions" ("expires_at");

CREATE INDEX "ix_sessions__current_organization_id_user_id"
ON "sessions" ("current_organization_id", "user_id");

CREATE INDEX "ix_password_recovery_tokens__user_id_created_at"
ON "password_recovery_tokens" ("user_id", "created_at" DESC);

CREATE INDEX "ix_password_recovery_tokens__expires_at"
ON "password_recovery_tokens" ("expires_at");

CREATE INDEX "ix_organization_invitations__organization_email_lifecycle"
ON "organization_invitations" ("organization_id", "intended_email_normalized", "accepted_at", "revoked_at");

CREATE INDEX "ix_organization_invitations__organization_created_at_id"
ON "organization_invitations" ("organization_id", "created_at" DESC, "id" DESC);

CREATE INDEX "ix_organization_invitations__expires_at"
ON "organization_invitations" ("expires_at");

CREATE INDEX "ix_organization_invitations__invited_by_user_id"
ON "organization_invitations" ("invited_by_user_id");

CREATE INDEX "ix_organization_invitations__accepted_by_user_id"
ON "organization_invitations" ("accepted_by_user_id");

CREATE UNIQUE INDEX "ux_organization_invitations__pending_email"
ON "organization_invitations" ("organization_id", "intended_email_normalized")
WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

CREATE INDEX "ix_identity_rate_limit_windows__expires_at"
ON "identity_rate_limit_windows" ("expires_at");

ALTER TABLE "user_password_credentials"
ADD CONSTRAINT "fk_user_password_credentials__user_id__users"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
ADD CONSTRAINT "fk_organization_memberships__organization_id__organizations"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
ADD CONSTRAINT "fk_organization_memberships__user_id__users"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sessions"
ADD CONSTRAINT "fk_sessions__user_id__users"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sessions"
ADD CONSTRAINT "fk_sessions__current_membership__organization_memberships"
FOREIGN KEY ("current_organization_id", "user_id")
REFERENCES "organization_memberships"("organization_id", "user_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "password_recovery_tokens"
ADD CONSTRAINT "fk_password_recovery_tokens__user_id__users"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "fk_organization_invitations__organization_id__organizations"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "fk_organization_invitations__invited_by_user_id__users"
FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "fk_organization_invitations__accepted_by_user_id__users"
FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
