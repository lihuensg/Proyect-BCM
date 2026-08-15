import { describe, expect, it } from "vitest";

import * as publicConfigBoundary from "./public-config";

describe("publicConfig", () => {
  it("exposes an immutable empty allowlist while Web needs no public values", () => {
    expect(Object.keys(publicConfigBoundary)).toEqual(["publicConfig"]);
    expect(publicConfigBoundary.publicConfig).toEqual({});
    expect(Object.isFrozen(publicConfigBoundary.publicConfig)).toBe(true);
  });
});
