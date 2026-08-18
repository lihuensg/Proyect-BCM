import { describe, expect, it } from "vitest";

import { canonicalizeClientIp } from "./client-ip.js";

describe("canonicalizeClientIp", () => {
  it.each([
    ["127.0.0.1", "127.0.0.1"],
    ["::ffff:127.0.0.1", "127.0.0.1"],
    ["2001:0DB8:0:0:0:0:0:1", "2001:db8::1"],
  ])("canonicalizes %s", (input, expected) => {
    expect(canonicalizeClientIp(input)).toBe(expected);
  });

  it.each([undefined, "unknown", "127.00.0.1"])("rejects %s", (input) => {
    expect(canonicalizeClientIp(input)).toBeNull();
  });
});
