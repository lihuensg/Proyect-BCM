import { describe, expect, it } from "vitest";

import { NodeRateLimitFingerprint } from "./node-rate-limit-fingerprint.js";

describe("NodeRateLimitFingerprint", () => {
  it("creates deterministic, purpose-separated, non-raw fingerprints", () => {
    const service = new NodeRateLimitFingerprint(Buffer.alloc(32, 9));
    const identity = service.identity("user@example.com");
    const network = service.network("127.0.0.1");

    expect(identity).toHaveLength(32);
    expect(service.identity("user@example.com")).toEqual(identity);
    expect(network).not.toEqual(identity);
    expect(identity.toString("utf8")).not.toContain("user@example.com");
    expect(service.identityNetwork("ab", "c")).not.toEqual(
      service.identityNetwork("a", "bc"),
    );
  });
});
