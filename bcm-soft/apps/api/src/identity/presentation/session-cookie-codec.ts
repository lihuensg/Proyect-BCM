import type { SessionCookieConfig } from "../../config/server-config.js";
import type { SessionTokenService } from "../application/session-token-service.js";

export class SessionCookieCodec {
  constructor(
    private readonly config: SessionCookieConfig,
    private readonly tokens: SessionTokenService,
  ) {
    if (config.name.startsWith("__Host-") && !config.secure) {
      throw new Error("A __Host- session cookie must be Secure.");
    }
  }

  parse(cookieHeader: string | undefined): string | null {
    if (cookieHeader === undefined || cookieHeader.length === 0) return null;

    const values: string[] = [];
    for (const segment of cookieHeader.split(";")) {
      const separator = segment.indexOf("=");
      if (separator < 0) continue;

      const name = segment.slice(0, separator).trim();
      if (name === this.config.name) {
        values.push(segment.slice(separator + 1).trim());
      }
    }

    if (values.length !== 1) return null;
    const token = values[0];
    return token !== undefined && this.tokens.isValidFormat(token)
      ? token
      : null;
  }

  serialize(rawToken: string, expiresAt: Date): string {
    return this.serializeValue(rawToken, [
      `Expires=${expiresAt.toUTCString()}`,
    ]);
  }

  serializeClear(): string {
    return this.serializeValue("", [
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
  }

  private serializeValue(value: string, expiryAttributes: string[]): string {
    return [
      `${this.config.name}=${value}`,
      `Path=${this.config.path}`,
      ...expiryAttributes,
      "HttpOnly",
      `SameSite=${this.config.sameSite}`,
      ...(this.config.secure ? ["Secure"] : []),
    ].join("; ");
  }
}
