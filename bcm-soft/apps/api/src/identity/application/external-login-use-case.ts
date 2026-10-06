import {
  type CreatedSession,
  SessionCreationError,
  type SessionService,
} from "./session-service.js";

export type ExternalIdentityProviderName = "auth0";

/** Browser-bound OIDC transaction state; never persisted server-side. */
export type ExternalLoginTransaction = Readonly<{
  state: string;
  nonce: string;
  codeVerifier: string;
}>;

export type VerifiedExternalIdentity = Readonly<{
  provider: ExternalIdentityProviderName;
  subject: string;
}>;

/** Raised for any provider, network, or token-verification failure. */
export class ExternalIdentityProviderError extends Error {
  constructor() {
    super("The external identity provider could not verify the login.");
    this.name = "ExternalIdentityProviderError";
  }
}

export interface ExternalIdentityProvider {
  authorizationUrl(transaction: ExternalLoginTransaction): Promise<string>;
  /** Ends the provider's own single sign-on session, then returns the browser. */
  logoutUrl(returnTo: string): Promise<string>;
  /**
   * Exchanges the authorization code over the back channel and returns the
   * subject only from an ID token whose signature, issuer, audience, expiry,
   * and nonce were verified.
   */
  verifyAuthorizationCode(
    input: Readonly<{ code: string; codeVerifier: string; nonce: string }>,
  ): Promise<VerifiedExternalIdentity>;
}

export interface ExternalIdentityRepository {
  findUserIdBySubject(
    provider: ExternalIdentityProviderName,
    subject: string,
  ): Promise<string | null>;
}

export type ExternalLoginDenialReason =
  | "state-mismatch"
  | "provider-rejected"
  | "provider-error"
  | "not-provisioned"
  | "session-refused";

export interface ExternalLoginAudit {
  recordExternalLoginSucceeded(userId: string): void;
  recordExternalLoginDenied(reason: ExternalLoginDenialReason): void;
}

export type ExternalLoginResult =
  | Readonly<{ status: "authenticated"; session: CreatedSession }>
  | Readonly<{
      status: "denied";
      reason: Exclude<
        ExternalLoginDenialReason,
        "state-mismatch" | "provider-rejected"
      >;
    }>;

export class ExternalLoginUseCase {
  constructor(
    private readonly provider: ExternalIdentityProvider,
    private readonly identities: ExternalIdentityRepository,
    private readonly sessions: Pick<SessionService, "createSession">,
    private readonly audit: ExternalLoginAudit,
  ) {}

  /** The caller has already matched the callback state to `transaction`. */
  async complete(
    input: Readonly<{ transaction: ExternalLoginTransaction; code: string }>,
  ): Promise<ExternalLoginResult> {
    let identity: VerifiedExternalIdentity;
    try {
      identity = await this.provider.verifyAuthorizationCode({
        code: input.code,
        codeVerifier: input.transaction.codeVerifier,
        nonce: input.transaction.nonce,
      });
    } catch (error: unknown) {
      if (error instanceof ExternalIdentityProviderError) {
        return this.deny("provider-error");
      }
      throw error;
    }

    // Users are provisioned administratively with their provider subject;
    // an unknown subject is never linked by email here (ADR-008).
    const userId = await this.identities.findUserIdBySubject(
      identity.provider,
      identity.subject,
    );
    if (userId === null) return this.deny("not-provisioned");

    let session: CreatedSession;
    try {
      session = await this.sessions.createSession(userId);
    } catch (error: unknown) {
      // Disabled User, or token-hash collisions exhausted.
      if (error instanceof SessionCreationError) {
        return this.deny("session-refused");
      }
      throw error;
    }

    this.audit.recordExternalLoginSucceeded(userId);
    return Object.freeze({ status: "authenticated", session });
  }

  private deny(
    reason: Exclude<
      ExternalLoginDenialReason,
      "state-mismatch" | "provider-rejected"
    >,
  ): ExternalLoginResult {
    this.audit.recordExternalLoginDenied(reason);
    return Object.freeze({ status: "denied", reason });
  }
}
