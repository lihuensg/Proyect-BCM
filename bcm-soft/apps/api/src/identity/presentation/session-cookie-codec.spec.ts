import { describe, expect, it } from "vitest";

import { NodeSessionTokenService } from "../infrastructure/node-session-token-service.js";
import { SessionCookieCodec } from "./session-cookie-codec.js";

const TOKEN = "A".repeat(43);
const EXPIRES_AT = new Date("2026-08-18T00:00:00.000Z");

function codec(environment: "production" | "test") {
  return new SessionCookieCodec(
    {
      name: environment === "production" ? "__Host-bcm_session" : "bcm_session",
      httpOnly: true,
      secure: environment === "production",
      sameSite: "Lax",
      path: "/",
    },
    new NodeSessionTokenService(),
  );
}

describe("SessionCookieCodec", () => {
  it("serializes the production cookie with the complete host-only policy", () => {
    const serialized = codec("production").serialize(TOKEN, EXPIRES_AT);

    expect(serialized).toBe(
      `__Host-bcm_session=${TOKEN}; Path=/; Expires=Tue, 18 Aug 2026 00:00:00 GMT; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(serialized).not.toContain("Domain=");
  });

  it("uses the controlled HTTP test cookie without weakening production", () => {
    const serialized = codec("test").serialize(TOKEN, EXPIRES_AT);

    expect(serialized).toContain(`bcm_session=${TOKEN}`);
    expect(serialized).toContain("HttpOnly");
    expect(serialized).toContain("SameSite=Lax");
    expect(serialized).not.toContain("Secure");
    expect(serialized).not.toContain("Domain=");
  });

  it("parses only one valid BCM cookie and tolerates unrelated cookies", () => {
    const cookies = codec("test");

    expect(cookies.parse(`theme=dark; bcm_session=${TOKEN}; locale=es`)).toBe(
      TOKEN,
    );
    expect(
      cookies.parse(`bcm_session=${TOKEN}; bcm_session=${TOKEN}`),
    ).toBeNull();
    expect(cookies.parse("bcm_session=malformed")).toBeNull();
    expect(cookies.parse("theme=dark")).toBeNull();
  });

  it("clears with attributes compatible with issuance", () => {
    expect(codec("production").serializeClear()).toBe(
      "__Host-bcm_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax; Secure",
    );
  });

  it("fails fast if a __Host- cookie is ever configured without Secure", () => {
    expect(
      () =>
        new SessionCookieCodec(
          {
            name: "__Host-bcm_session",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
            path: "/",
          },
          new NodeSessionTokenService(),
        ),
    ).toThrow("A __Host- session cookie must be Secure.");
  });
});
