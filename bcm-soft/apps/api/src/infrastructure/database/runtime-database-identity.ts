import type { PrismaClient } from "../../generated/prisma/client.js";

type RuntimeIdentityProfile = Readonly<{
  currentUser: string;
  isSuperuser: boolean;
  bypassesRowLevelSecurity: boolean;
  ownsDatabase: boolean;
  ownsApplicationSchema: boolean;
}>;

export class UnsafeRuntimeDatabaseIdentityError extends Error {
  constructor() {
    super("The runtime database identity is not safely restricted.");
    this.name = "UnsafeRuntimeDatabaseIdentityError";
  }
}

export function assertSafeRuntimeIdentityProfile(
  profile: RuntimeIdentityProfile,
  expectedCurrentUser: string = profile.currentUser,
): void {
  if (
    profile.currentUser !== expectedCurrentUser ||
    profile.isSuperuser ||
    profile.bypassesRowLevelSecurity ||
    profile.ownsDatabase ||
    profile.ownsApplicationSchema
  ) {
    throw new UnsafeRuntimeDatabaseIdentityError();
  }
}

export async function assertSafeRuntimeDatabaseIdentity(
  client: PrismaClient,
  expectedCurrentUser: string,
): Promise<void> {
  const profiles = await client.$queryRaw<
    Array<{
      current_user: string;
      is_superuser: boolean;
      bypasses_row_level_security: boolean;
      owns_database: boolean;
      owns_application_schema: boolean;
    }>
  >`
    SELECT
      current_user,
      role.rolsuper AS is_superuser,
      role.rolbypassrls AS bypasses_row_level_security,
      database.datdba = role.oid AS owns_database,
      namespace.nspowner = role.oid AS owns_application_schema
    FROM pg_roles AS role
    JOIN pg_database AS database ON database.datname = current_database()
    JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
    WHERE role.rolname = current_user
  `;
  const profile = profiles[0];

  if (profiles.length !== 1 || profile === undefined) {
    throw new UnsafeRuntimeDatabaseIdentityError();
  }

  assertSafeRuntimeIdentityProfile(
    {
      currentUser: profile.current_user,
      isSuperuser: profile.is_superuser,
      bypassesRowLevelSecurity: profile.bypasses_row_level_security,
      ownsDatabase: profile.owns_database,
      ownsApplicationSchema: profile.owns_application_schema,
    },
    expectedCurrentUser,
  );
}
