import type { ExternalIdentityProviderName } from "./external-login-use-case.js";

/** An account at the external identity provider, keyed by its subject. */
export type ExternalAccount = Readonly<{
  provider: ExternalIdentityProviderName;
  subject: string;
  /** True only when this call created the account at the provider. */
  created: boolean;
}>;

/** The provider is unreachable, misconfigured, or answered unexpectedly. */
export class ExternalAccountDirectoryError extends Error {
  constructor() {
    super("The external account directory is unavailable.");
    this.name = "ExternalAccountDirectoryError";
  }
}

/** The email already belongs to a provider account BCM cannot manage. */
export class ExternalAccountConflictError extends Error {
  constructor() {
    super("The email belongs to an unmanaged external account.");
    this.name = "ExternalAccountConflictError";
  }
}

/**
 * Administrative account management at the identity provider. Calls are
 * network I/O and must never run inside a database transaction.
 */
export interface ExternalAccountDirectory {
  ensureAccount(normalizedEmail: string): Promise<ExternalAccount>;
  /** Asks the provider to email the User a link to choose a password. */
  sendPasswordSetup(normalizedEmail: string): Promise<void>;
}

export type UserLinkResult =
  | Readonly<{ status: "linked"; userId: string }>
  | Readonly<{ status: "user-disabled" }>
  | Readonly<{ status: "identity-conflict" }>;

/**
 * Identity-owned persistence for administrative provisioning. Infrastructure
 * binds it to the caller's transaction so User, link, Membership, and Audit
 * Record commit together.
 */
export interface UserProvisioningRepository {
  findUserIdByEmail(normalizedEmail: string): Promise<string | null>;
  /**
   * Returns the existing or newly created User for the email, linked to the
   * provider subject. A User already linked to another subject, or a subject
   * already linked to another User, is a conflict and changes nothing.
   */
  ensureUserLinkedTo(
    input: Readonly<{
      email: string;
      normalizedEmail: string;
      account: Pick<ExternalAccount, "provider" | "subject">;
      newUserId: string;
      newLinkId: string;
      now: Date;
    }>,
  ): Promise<UserLinkResult>;
  findEmailsByUserIds(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}
