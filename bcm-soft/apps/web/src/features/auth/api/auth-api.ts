import { ApiError } from "../../../lib/http/api-error";
import type { ApiClient } from "../../../lib/http/api-client";
import {
  authenticatedSessionSchema,
  type SessionResult,
} from "./auth-contracts";

export class AuthApi {
  constructor(private readonly client: ApiClient) {}

  /** Starts the Auth0 login; the API redirects back to the Web app. */
  loginUrl(): string {
    return this.client.url("/auth/auth0/start");
  }

  /** Ends the Auth0 single sign-on session after BCM logout. */
  providerLogoutUrl(): string {
    return this.client.url("/auth/auth0/logout");
  }

  async getSession(): Promise<SessionResult> {
    try {
      const session = await this.client.requestJson(
        "/auth/session",
        authenticatedSessionSchema,
        { classification: "public" },
      );
      return { status: "authenticated", session };
    } catch (error: unknown) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        error.code === "AUTHENTICATION_REQUIRED"
      ) {
        return { status: "anonymous" };
      }
      throw error;
    }
  }

  async logout(csrfToken: string): Promise<void> {
    await this.client.requestNoContent("/auth/logout", {
      method: "POST",
      classification: "authenticated-mutation",
      csrfToken,
    });
  }
}
