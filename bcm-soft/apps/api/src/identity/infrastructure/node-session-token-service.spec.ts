import { describe, expect, it, vi } from "vitest";

import { NodeSessionTokenService } from "./node-session-token-service.js";

describe("NodeSessionTokenService", () => {
  it("generates a 256-bit opaque Base64URL token", () => {
    const randomSource = vi.fn(() => Buffer.alloc(32, 0xff));
    const service = new NodeSessionTokenService(randomSource);
    const token = service.generate();

    expect(randomSource).toHaveBeenCalledOnce();
    expect(randomSource).toHaveBeenCalledWith(32);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(token).not.toContain("=");
    expect(service.isValidFormat(token)).toBe(true);
  });

  it("generates representative unique values with the production CSPRNG", () => {
    const service = new NodeSessionTokenService();
    const tokens = Array.from({ length: 128 }, () => service.generate());

    expect(new Set(tokens)).toHaveLength(tokens.length);
  });

  it("uses the stable purpose-separated SHA-256 framing", () => {
    const service = new NodeSessionTokenService();
    const token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const digest = service.digest(token);

    expect(digest).toHaveLength(32);
    expect(digest.toString("hex")).toBe(
      "6320d749f4360af787780dd2035ca5901e56b789c85fae8329ce8278e2f87fce",
    );
    expect(service.digest(token)).toEqual(digest);
    expect(
      service.digest("BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    ).not.toEqual(digest);
  });

  it.each(["", "short", `${"a".repeat(42)}=`, "a".repeat(44), "!".repeat(43)])(
    "rejects malformed token format %j",
    (token) => {
      expect(new NodeSessionTokenService().isValidFormat(token)).toBe(false);
    },
  );
});
