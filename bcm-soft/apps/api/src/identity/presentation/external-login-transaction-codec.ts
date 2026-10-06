import {
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { SessionCookieConfig } from "../../config/server-config.js";
import type { Clock } from "../application/clock.js";
import type { ExternalLoginTransaction } from "../application/external-login-use-case.js";

const TRANSACTION_LIFETIME_MILLISECONDS = 10 * 60_000;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_COOKIE_VALUE_LENGTH = 512;
// Domain-separated from the CSRF key it is derived from (RFC 5869 info).
const KEY_DERIVATION_INFO = "bcm-soft/oidc-transaction-cookie/v1";

type TransactionPayload = Readonly<{
  v: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}>;

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function sameBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePayload(json: string): TransactionPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).length !== 5 ||
    payload.v !== 1 ||
    typeof payload.state !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.codeVerifier !== "string" ||
    typeof payload.expiresAt !== "number" ||
    !Number.isSafeInteger(payload.expiresAt) ||
    !SECRET_PATTERN.test(payload.state) ||
    !SECRET_PATTERN.test(payload.nonce) ||
    !SECRET_PATTERN.test(payload.codeVerifier)
  ) {
    return null;
  }
  return {
    v: 1,
    state: payload.state,
    nonce: payload.nonce,
    codeVerifier: payload.codeVerifier,
    expiresAt: payload.expiresAt,
  };
}

/**
 * Carries one OIDC login transaction in an HttpOnly cookie signed with a key
 * derived from the CSRF HMAC key. It mirrors the session cookie's name prefix,
 * Secure, and SameSite=Lax posture; Lax is required so the top-level redirect
 * back from the identity provider includes it.
 */
export class ExternalLoginTransactionCodec {
  private readonly name: string;
  private readonly key: Buffer;

  constructor(
    private readonly cookie: SessionCookieConfig,
    csrfHmacKey: Buffer,
    private readonly clock: Clock,
  ) {
    this.name = cookie.name.startsWith("__Host-")
      ? "__Host-bcm_oidc"
      : "bcm_oidc";
    this.key = Buffer.from(
      hkdfSync("sha256", csrfHmacKey, Buffer.alloc(0), KEY_DERIVATION_INFO, 32),
    );
  }

  issue(): Readonly<{
    transaction: ExternalLoginTransaction;
    setCookie: string;
  }> {
    const transaction = Object.freeze({
      state: randomSecret(),
      nonce: randomSecret(),
      codeVerifier: randomSecret(),
    });
    const payload: TransactionPayload = {
      v: 1,
      ...transaction,
      expiresAt: this.clock.now().getTime() + TRANSACTION_LIFETIME_MILLISECONDS,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    return Object.freeze({
      transaction,
      setCookie: this.serialize(`${encoded}.${this.sign(encoded)}`, [
        `Max-Age=${TRANSACTION_LIFETIME_MILLISECONDS / 1000}`,
      ]),
    });
  }

  /**
   * Returns the transaction only when the cookie is authentic, unexpired, and
   * its state equals the state the provider echoed back.
   */
  readMatching(
    cookieHeader: string | undefined,
    receivedState: string,
  ): ExternalLoginTransaction | null {
    const value = this.readCookieValue(cookieHeader);
    if (value === null) return null;

    const separator = value.indexOf(".");
    if (separator <= 0) return null;
    const encoded = value.slice(0, separator);
    const signature = Buffer.from(value.slice(separator + 1), "base64url");
    if (!sameBytes(Buffer.from(this.sign(encoded), "base64url"), signature)) {
      return null;
    }

    const payload = parsePayload(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (
      payload === null ||
      payload.expiresAt <= this.clock.now().getTime() ||
      !sameBytes(
        Buffer.from(payload.state, "utf8"),
        Buffer.from(receivedState, "utf8"),
      )
    ) {
      return null;
    }
    return Object.freeze({
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
    });
  }

  serializeClear(): string {
    return this.serialize("", [
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
  }

  private sign(encoded: string): string {
    return createHmac("sha256", this.key).update(encoded).digest("base64url");
  }

  private readCookieValue(cookieHeader: string | undefined): string | null {
    if (cookieHeader === undefined || cookieHeader.length === 0) return null;
    const values: string[] = [];
    for (const segment of cookieHeader.split(";")) {
      const separator = segment.indexOf("=");
      if (separator < 0) continue;
      if (segment.slice(0, separator).trim() === this.name) {
        values.push(segment.slice(separator + 1).trim());
      }
    }
    if (values.length !== 1) return null;
    const value = values[0];
    return value !== undefined &&
      value.length > 0 &&
      value.length <= MAX_COOKIE_VALUE_LENGTH
      ? value
      : null;
  }

  private serialize(value: string, expiryAttributes: string[]): string {
    return [
      `${this.name}=${value}`,
      "Path=/",
      ...expiryAttributes,
      "HttpOnly",
      `SameSite=${this.cookie.sameSite}`,
      ...(this.cookie.secure ? ["Secure"] : []),
    ].join("; ");
  }
}
