import { describe, expect, it } from "vitest";

import type { SessionCookieConfig } from "../../config/server-config.js";
import { ExternalLoginTransactionCodec } from "./external-login-transaction-codec.js";

const PRODUCTION_COOKIE: SessionCookieConfig = Object.freeze({
  name: "__Host-bcm_session",
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
});
const DEVELOPMENT_COOKIE: SessionCookieConfig = Object.freeze({
  ...PRODUCTION_COOKIE,
  name: "bcm_session",
  secure: false,
});
const KEY = Buffer.alloc(32, 7);

function clockAt(milliseconds: number) {
  return { now: () => new Date(milliseconds) };
}

function cookieHeaderFrom(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

describe("ExternalLoginTransactionCodec", () => {
  it("issues a signed, HttpOnly, Lax, __Host- cookie with fresh secrets", () => {
    const codec = new ExternalLoginTransactionCodec(
      PRODUCTION_COOKIE,
      KEY,
      clockAt(0),
    );
    const first = codec.issue();
    const second = codec.issue();

    expect(first.setCookie).toMatch(
      /^__Host-bcm_oidc=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/u,
    );
    for (const secret of Object.values(first.transaction)) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
    expect(new Set(Object.values(first.transaction)).size).toBe(3);
    expect(second.transaction.state).not.toBe(first.transaction.state);
  });

  it("returns the transaction only for the matching state before expiry", () => {
    const codec = new ExternalLoginTransactionCodec(
      DEVELOPMENT_COOKIE,
      KEY,
      clockAt(1_000),
    );
    const { transaction, setCookie } = codec.issue();
    const header = `other=1; ${cookieHeaderFrom(setCookie)}`;

    expect(setCookie.startsWith("bcm_oidc=")).toBe(true);
    expect(setCookie).not.toContain("Secure");
    expect(codec.readMatching(header, transaction.state)).toEqual(transaction);
    expect(codec.readMatching(header, `${transaction.state.slice(1)}x`)).toBe(
      null,
    );

    const later = new ExternalLoginTransactionCodec(
      DEVELOPMENT_COOKIE,
      KEY,
      clockAt(1_000 + 600_000),
    );
    expect(later.readMatching(header, transaction.state)).toBe(null);
  });

  it("rejects tampered payloads, foreign keys, and duplicate cookies", () => {
    const codec = new ExternalLoginTransactionCodec(
      DEVELOPMENT_COOKIE,
      KEY,
      clockAt(0),
    );
    const { transaction, setCookie } = codec.issue();
    const header = cookieHeaderFrom(setCookie);
    const [name, value] = header.split("=") as [string, string];
    const [payload, signature] = value.split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        expiresAt: Number.MAX_SAFE_INTEGER,
      }),
    ).toString("base64url");
    const otherKey = new ExternalLoginTransactionCodec(
      DEVELOPMENT_COOKIE,
      Buffer.alloc(32, 8),
      clockAt(0),
    );

    expect(
      codec.readMatching(`${name}=${forged}.${signature}`, transaction.state),
    ).toBe(null);
    expect(otherKey.readMatching(header, transaction.state)).toBe(null);
    expect(codec.readMatching(`${header}; ${header}`, transaction.state)).toBe(
      null,
    );
    expect(codec.readMatching(undefined, transaction.state)).toBe(null);
  });

  it("clears the cookie with the same name and attributes", () => {
    const codec = new ExternalLoginTransactionCodec(
      PRODUCTION_COOKIE,
      KEY,
      clockAt(0),
    );

    expect(codec.serializeClear()).toBe(
      "__Host-bcm_oidc=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax; Secure",
    );
  });
});
