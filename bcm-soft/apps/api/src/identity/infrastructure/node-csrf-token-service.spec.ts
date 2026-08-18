import { describe, expect, it } from "vitest";

import { NodeCsrfTokenService } from "./node-csrf-token-service.js";

describe("NodeCsrfTokenService", () => {
  it("derives a stable session-bound v1 token and verifies it", () => {
    const service = new NodeCsrfTokenService(Buffer.alloc(32, 7));
    const token = service.derive("A".repeat(43));

    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/u);
    expect(service.derive("A".repeat(43))).toBe(token);
    expect(service.verify("A".repeat(43), token)).toBe(true);
    expect(service.verify("B".repeat(43), token)).toBe(false);
  });

  it.each(["", "v2.invalid", "v1.not/base64url", `v1.${"A".repeat(42)}`])(
    "strictly rejects malformed token %s",
    (token) => {
      expect(
        new NodeCsrfTokenService(Buffer.alloc(32, 7)).verify(
          "A".repeat(43),
          token,
        ),
      ).toBe(false);
    },
  );
});
