import { describe, expect, it } from "vitest";

import { NodeRateLimitFingerprint } from "../infrastructure/node-rate-limit-fingerprint.js";
import { LocalNetworkRateLimiter } from "./local-network-rate-limiter.js";

describe("LocalNetworkRateLimiter", () => {
  it("allows the threshold and blocks the first excess attempt with bounded retry", () => {
    let now = new Date("2026-08-18T12:00:00.000Z");
    const limiter = new LocalNetworkRateLimiter(
      new NodeRateLimitFingerprint(Buffer.alloc(32, 3)),
      { now: () => now },
      {
        maximumAttempts: 2,
        windowMilliseconds: 60_000,
        blockMilliseconds: 30_000,
      },
      2,
    );

    expect(limiter.consume("127.0.0.1")).toEqual({ allowed: true });
    expect(limiter.consume("127.0.0.1")).toEqual({ allowed: true });
    expect(limiter.consume("127.0.0.1")).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    now = new Date(now.getTime() + 31_000);
    expect(limiter.consume("127.0.0.2")).toEqual({ allowed: true });
  });

  it("preserves an active block across a fixed-window boundary without extending it", () => {
    let now = new Date("2026-08-18T12:00:50.000Z");
    const limiter = new LocalNetworkRateLimiter(
      new NodeRateLimitFingerprint(Buffer.alloc(32, 4)),
      { now: () => now },
      {
        maximumAttempts: 1,
        windowMilliseconds: 60_000,
        blockMilliseconds: 60_000,
      },
    );

    expect(limiter.consume("127.0.0.1")).toEqual({ allowed: true });
    expect(limiter.consume("127.0.0.1")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    now = new Date("2026-08-18T12:01:10.000Z");
    expect(limiter.consume("127.0.0.1")).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });
  });
});
