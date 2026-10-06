import { describe, expect, it } from "vitest";

import { NodeRateLimitFingerprint } from "./node-rate-limit-fingerprint.js";

describe("NodeRateLimitFingerprint", () => {
  it("creates deterministic, keyed, non-raw network fingerprints", () => {
    const service = new NodeRateLimitFingerprint(Buffer.alloc(32, 9));
    const network = service.network("127.0.0.1");

    expect(network).toHaveLength(32);
    expect(service.network("127.0.0.1")).toEqual(network);
    expect(service.network("127.0.0.2")).not.toEqual(network);
    expect(network.toString("utf8")).not.toContain("127.0.0.1");
    expect(
      new NodeRateLimitFingerprint(Buffer.alloc(32, 8)).network("127.0.0.1"),
    ).not.toEqual(network);
  });
});
