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

CREATE TABLE "user_external_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pk_user_external_identities" PRIMARY KEY ("id"),
    CONSTRAINT "ck_user_external_identities__provider" CHECK ("provider" IN ('auth0')),
    CONSTRAINT "ck_user_external_identities__subject_length" CHECK (length("subject") BETWEEN 1 AND 255),
    CONSTRAINT "uq_user_external_identities__provider_subject" UNIQUE ("provider", "subject"),
    CONSTRAINT "uq_user_external_identities__user_id_provider" UNIQUE ("user_id", "provider")
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

CREATE INDEX "ix_organization_memberships__user_id_status"
ON "organization_memberships" ("user_id", "status");

CREATE INDEX "ix_sessions__user_id_revoked_at"
ON "sessions" ("user_id", "revoked_at");

CREATE INDEX "ix_sessions__expires_at"
ON "sessions" ("expires_at");

CREATE INDEX "ix_sessions__current_organization_id_user_id"
ON "sessions" ("current_organization_id", "user_id");

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

ALTER TABLE "user_external_identities"
ADD CONSTRAINT "fk_user_external_identities__user_id__users"
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

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "fk_organization_invitations__organization_id__organizations"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "fk_organization_invitations__invited_by_user_id__users"
FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "fk_organization_invitations__accepted_by_user_id__users"
FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
