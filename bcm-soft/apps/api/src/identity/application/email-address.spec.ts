import { describe, expect, it } from "vitest";

import { EmailAddressError, normalizeIdentityEmail } from "./email-address.js";

describe("normalizeIdentityEmail", () => {
  it("trims and lowercases with the approved JavaScript transformation", () => {
    expect(normalizeIdentityEmail("  User.Name@Example.COM  ")).toBe(
      "user.name@example.com",
    );
    expect(normalizeIdentityEmail("USER.NAME@example.com")).toBe(
      "user.name@example.com",
    );
  });

  it("preserves Unicode composition while applying JavaScript lowercase", () => {
    const composed = "É@example.com";
    const decomposed = "E\u0301@example.com";

    expect(normalizeIdentityEmail(composed)).toBe("é@example.com");
    expect(normalizeIdentityEmail(decomposed)).toBe("e\u0301@example.com");
    expect(normalizeIdentityEmail(composed)).not.toBe(
      normalizeIdentityEmail(decomposed),
    );
  });

  it.each([
    "",
    "   ",
    "missing-at.example.com",
    "@example.com",
    "local@",
    "two@@example.com",
    "white space@example.com",
    "local@example .com",
  ])("rejects malformed basic email %j", (email) => {
    expect(() => normalizeIdentityEmail(email)).toThrow(EmailAddressError);
  });

  it("rejects more than 254 code points after trim", () => {
    const oversized = `${"a".repeat(243)}@example.com`;
    expect([...oversized]).toHaveLength(255);
    expect(() => normalizeIdentityEmail(` ${oversized} `)).toThrowError(
      expect.objectContaining({ code: "EMAIL_TOO_LONG" }),
    );
  });
});
