import { randomBytes } from "node:crypto";

import type { Auth0Config } from "../../config/server-config.js";
import {
  type ExternalAccount,
  ExternalAccountConflictError,
  type ExternalAccountDirectory,
  ExternalAccountDirectoryError,
} from "../application/user-provisioning.js";

const REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const TOKEN_REFRESH_MARGIN_MILLISECONDS = 60_000;
const MAX_SUBJECT_LENGTH = 255;

type CachedToken = Readonly<{ value: string; expiresAt: number }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSubject(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SUBJECT_LENGTH
  );
}

/**
 * The User never sees or receives this password: it only satisfies the
 * connection's password policy until the User sets their own through the
 * provider's password-setup email.
 */
function unusablePassword(): string {
  return `${randomBytes(32).toString("base64url")}Aa1!`;
}

/**
 * Auth0 Management API adapter using a machine-to-machine client restricted
 * to `create:users` and `read:users`. No Auth0 response body leaves here.
 */
export class Auth0ManagementDirectory implements ExternalAccountDirectory {
  private readonly issuer: URL;
  private token: CachedToken | null = null;

  constructor(
    private readonly config: Pick<
      Auth0Config,
      "issuerUrl" | "clientId" | "management"
    >,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.issuer = new URL(config.issuerUrl);
  }

  ensureAccount(normalizedEmail: string): Promise<ExternalAccount> {
    return this.mapFailures(() => this.createOrFindAccount(normalizedEmail));
  }

  sendPasswordSetup(normalizedEmail: string): Promise<void> {
    return this.mapFailures(() => this.requestPasswordSetup(normalizedEmail));
  }

  private async mapFailures<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof ExternalAccountConflictError) throw error;
      throw new ExternalAccountDirectoryError();
    }
  }

  private async createOrFindAccount(
    normalizedEmail: string,
  ): Promise<ExternalAccount> {
    const response = await this.managementRequest("api/v2/users", {
      method: "POST",
      body: JSON.stringify({
        connection: this.config.management.connection,
        email: normalizedEmail,
        password: unusablePassword(),
        email_verified: false,
        verify_email: false,
      }),
    });
    if (response.status === 201) {
      const body: unknown = await response.json();
      if (!isRecord(body) || !validSubject(body.user_id)) {
        throw new ExternalAccountDirectoryError();
      }
      return Object.freeze({
        provider: "auth0",
        subject: body.user_id,
        created: true,
      });
    }
    if (response.status === 409) {
      return this.findExistingAccount(normalizedEmail);
    }
    throw new ExternalAccountDirectoryError();
  }

  private async requestPasswordSetup(normalizedEmail: string): Promise<void> {
    // Authentication API: Auth0 itself sends the change-password email.
    const response = await this.request(
      new URL("dbconnections/change_password", this.issuer),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: this.config.clientId,
          email: normalizedEmail,
          connection: this.config.management.connection,
        }),
      },
    );
    if (!response.ok) throw new ExternalAccountDirectoryError();
  }

  private async findExistingAccount(
    normalizedEmail: string,
  ): Promise<ExternalAccount> {
    const url = new URL("api/v2/users-by-email", this.issuer);
    url.searchParams.set("email", normalizedEmail);
    const response = await this.managementRequest(url, { method: "GET" });
    if (!response.ok) throw new ExternalAccountDirectoryError();
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new ExternalAccountDirectoryError();

    // Only an account in BCM's own database connection is manageable; a
    // social or enterprise account with the same email is not linked.
    const matches = body.filter(
      (user): user is Record<string, unknown> =>
        isRecord(user) &&
        Array.isArray(user.identities) &&
        user.identities.some(
          (identity: unknown) =>
            isRecord(identity) &&
            identity.connection === this.config.management.connection,
        ),
    );
    const subject = matches[0]?.user_id;
    if (matches.length !== 1 || !validSubject(subject)) {
      throw new ExternalAccountConflictError();
    }
    return Object.freeze({ provider: "auth0", subject, created: false });
  }

  private async managementRequest(
    path: string | URL,
    init: Readonly<{ method: "GET" | "POST"; body?: string }>,
  ): Promise<Response> {
    const accessToken = await this.accessToken();
    return this.request(
      path instanceof URL ? path : new URL(path, this.issuer),
      {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
      },
    );
  }

  private async accessToken(): Promise<string> {
    if (
      this.token !== null &&
      this.token.expiresAt - TOKEN_REFRESH_MARGIN_MILLISECONDS > this.now()
    ) {
      return this.token.value;
    }
    const response = await this.request(new URL("oauth/token", this.issuer), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.config.management.clientId,
        client_secret: this.config.management.clientSecret,
        audience: new URL("api/v2/", this.issuer).href,
      }),
    });
    if (!response.ok) throw new ExternalAccountDirectoryError();
    const body: unknown = await response.json();
    if (
      !isRecord(body) ||
      typeof body.access_token !== "string" ||
      typeof body.expires_in !== "number" ||
      body.expires_in <= 0
    ) {
      throw new ExternalAccountDirectoryError();
    }
    this.token = Object.freeze({
      value: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    });
    return this.token.value;
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImplementation(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch {
      throw new ExternalAccountDirectoryError();
    }
  }
}
