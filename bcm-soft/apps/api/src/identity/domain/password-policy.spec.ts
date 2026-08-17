import { describe, expect, it } from "vitest";

import {
  assertPasswordPolicy,
  PasswordPolicyError,
} from "./password-policy.js";

function expectPolicyError(
  password: unknown,
  code: PasswordPolicyError["code"],
): void {
  try {
    assertPasswordPolicy(password);
  } catch (error) {
    expect(error).toBeInstanceOf(PasswordPolicyError);
    expect((error as PasswordPolicyError).code).toBe(code);
    expect((error as Error).message).not.toContain(String(password));
    return;
  }

  throw new Error("Expected password policy validation to fail.");
}

describe("password policy", () => {
  it("rejects 14 code points and accepts 15", () => {
    expectPolicyError("a".repeat(14), "PASSWORD_TOO_SHORT");
    expect(() => assertPasswordPolicy("a".repeat(15))).not.toThrow();
  });

  it("accepts 128 code points and rejects 129 without truncating", () => {
    expect(() => assertPasswordPolicy("a".repeat(128))).not.toThrow();
    expectPolicyError("a".repeat(129), "PASSWORD_TOO_LONG");
  });

  it("counts surrogate pairs as single Unicode code points", () => {
    const password = "😀".repeat(15);

    expect(password.length).toBe(30);
    expect(Array.from(password)).toHaveLength(15);
    expect(() => assertPasswordPolicy(password)).not.toThrow();
  });

  it("allows multibyte Unicode, spaces, and a single character class", () => {
    expect(() => assertPasswordPolicy(" contraseña segura ")).not.toThrow();
    expect(() => assertPasswordPolicy("界".repeat(15))).not.toThrow();
    expect(() => assertPasswordPolicy("x".repeat(15))).not.toThrow();
  });

  it("preserves canonically equivalent Unicode sequences", () => {
    const composed = "é".repeat(15);
    const decomposed = "e\u0301".repeat(15);

    expect(composed).not.toBe(decomposed);
    expect(() => assertPasswordPolicy(composed)).not.toThrow();
    expect(() => assertPasswordPolicy(decomposed)).not.toThrow();
  });

  it("rejects non-string input without exposing it", () => {
    expectPolicyError({ password: "sensitive" }, "PASSWORD_INVALID_TYPE");
  });
});
