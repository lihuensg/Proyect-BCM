import { describe, expect, it } from "vitest";

import {
  isSessionExpired,
  isSessionTouchDue,
  sessionEffectiveDeadline,
} from "./session-policy.js";

const base = new Date("2026-08-17T12:00:00.000Z");

describe("session policy", () => {
  it("uses the earlier idle deadline", () => {
    const absolute = new Date(base.getTime() + 12 * 60 * 60_000);
    const deadline = sessionEffectiveDeadline(absolute, base, 30 * 60_000);

    expect(deadline).toEqual(new Date(base.getTime() + 30 * 60_000));
    expect(
      isSessionExpired(
        new Date(deadline.getTime() - 1),
        absolute,
        base,
        30 * 60_000,
      ),
    ).toBe(false);
    expect(isSessionExpired(deadline, absolute, base, 30 * 60_000)).toBe(true);
    expect(
      isSessionExpired(
        new Date(deadline.getTime() + 1),
        absolute,
        base,
        30 * 60_000,
      ),
    ).toBe(true);
  });

  it("uses the earlier absolute deadline", () => {
    const absolute = new Date(base.getTime() + 10 * 60_000);

    expect(sessionEffectiveDeadline(absolute, base, 30 * 60_000)).toEqual(
      absolute,
    );
    expect(
      isSessionExpired(
        new Date(absolute.getTime() - 1),
        absolute,
        base,
        30 * 60_000,
      ),
    ).toBe(false);
    expect(isSessionExpired(absolute, absolute, base, 30 * 60_000)).toBe(true);
    expect(
      isSessionExpired(
        new Date(absolute.getTime() + 1),
        absolute,
        base,
        30 * 60_000,
      ),
    ).toBe(true);
  });

  it("makes touch due exactly at the configured interval", () => {
    expect(
      isSessionTouchDue(new Date(base.getTime() + 300_000 - 1), base, 300_000),
    ).toBe(false);
    expect(
      isSessionTouchDue(new Date(base.getTime() + 300_000), base, 300_000),
    ).toBe(true);
  });
});
