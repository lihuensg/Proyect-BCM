import { normalizeIdentityEmail } from "../../identity/application/email-address.js";
import {
  type ExternalAccount,
  ExternalAccountConflictError,
  type ExternalAccountDirectory,
  ExternalAccountDirectoryError,
} from "../../identity/application/user-provisioning.js";
import type { Clock } from "../../identity/application/clock.js";

const MAX_ORGANIZATION_NAME_LENGTH = 120;

type IdentifierGenerator = () => string;

export type InitialSetupWriteResult =
  "completed" | "already-configured" | "user-disabled" | "identity-conflict";

export interface InitialSetupRepository {
  /** True while no Organization exists. */
  isSetupRequired(): Promise<boolean>;
  /**
   * Atomically, and only if still no Organization exists: creates the
   * Organization, the Owner User linked to the provider account, the Owner
   * Membership, and its Audit Record. Any rejection writes nothing.
   */
  complete(
    input: Readonly<{
      organizationId: string;
      organizationName: string;
      email: string;
      account: Pick<ExternalAccount, "provider" | "subject">;
      newIdentifier: IdentifierGenerator;
      correlationId: string | null;
      now: Date;
    }>,
  ): Promise<InitialSetupWriteResult>;
}

export type InitialSetupResult =
  | Readonly<{
      status: "completed";
      organizationId: string;
      ownerEmail: string;
      passwordSetupEmail: "sent" | "failed" | "not-required";
    }>
  | Readonly<{ status: "already-configured" }>
  | Readonly<{ status: "invalid-email" }>
  | Readonly<{ status: "invalid-organization-name" }>
  | Readonly<{ status: "identity-conflict" }>
  | Readonly<{ status: "provider-unavailable" }>;

export interface InitialSetupLog {
  recordPasswordSetupEmailFailed(): void;
}

/**
 * One-time platform bootstrap: the first Organization and its Owner. The
 * caller has already verified the server-side setup token.
 */
export class InitialSetup {
  constructor(
    private readonly repository: InitialSetupRepository,
    private readonly accounts: ExternalAccountDirectory,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
    private readonly log: InitialSetupLog,
  ) {}

  isRequired(): Promise<boolean> {
    return this.repository.isSetupRequired();
  }

  async complete(
    input: Readonly<{
      organizationName: string;
      ownerEmail: string;
      correlationId: string | null;
    }>,
  ): Promise<InitialSetupResult> {
    const organizationName = input.organizationName.trim();
    if (
      organizationName.length === 0 ||
      [...organizationName].length > MAX_ORGANIZATION_NAME_LENGTH
    ) {
      return Object.freeze({ status: "invalid-organization-name" });
    }
    let email: string;
    try {
      email = normalizeIdentityEmail(input.ownerEmail);
    } catch {
      return Object.freeze({ status: "invalid-email" });
    }
    // Avoids creating a provider account when setup is clearly done; the
    // write below re-checks under a lock.
    if (!(await this.repository.isSetupRequired())) {
      return Object.freeze({ status: "already-configured" });
    }

    let account: ExternalAccount;
    try {
      account = await this.accounts.ensureAccount(email);
    } catch (error: unknown) {
      if (error instanceof ExternalAccountConflictError) {
        return Object.freeze({ status: "identity-conflict" });
      }
      if (error instanceof ExternalAccountDirectoryError) {
        return Object.freeze({ status: "provider-unavailable" });
      }
      throw error;
    }

    const organizationId = this.identifiers();
    const written = await this.repository.complete({
      organizationId,
      organizationName,
      email,
      account,
      newIdentifier: this.identifiers,
      correlationId: input.correlationId,
      now: this.clock.now(),
    });
    if (written === "already-configured") {
      return Object.freeze({ status: "already-configured" });
    }
    if (written !== "completed") {
      return Object.freeze({ status: "identity-conflict" });
    }

    let passwordSetupEmail: "sent" | "failed" | "not-required" = "not-required";
    if (account.created) {
      try {
        await this.accounts.sendPasswordSetup(email);
        passwordSetupEmail = "sent";
      } catch (error: unknown) {
        if (!(error instanceof ExternalAccountDirectoryError)) throw error;
        this.log.recordPasswordSetupEmailFailed();
        passwordSetupEmail = "failed";
      }
    }

    return Object.freeze({
      status: "completed",
      organizationId,
      ownerEmail: email,
      passwordSetupEmail,
    });
  }
}
