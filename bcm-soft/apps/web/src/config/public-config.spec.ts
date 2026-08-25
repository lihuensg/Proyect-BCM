import { describe, expect, it } from "vitest";

import { loadPublicConfig, publicConfig } from "./public-config";

describe("publicConfig", () => {
  it("exposes an immutable, normalized API base URL", () => {
    expect(
      loadPublicConfig({
        MODE: "production",
        VITE_API_BASE_URL: "https://api.bcm.test/api///",
      }),
    ).toEqual({ apiBaseUrl: "https://api.bcm.test/api" });
    expect(Object.isFrozen(publicConfig)).toBe(true);
  });

  it("requires production configuration and rejects unsafe URLs", () => {
    expect(() => loadPublicConfig({ MODE: "production" })).toThrow(
      "VITE_API_BASE_URL is required",
    );
    expect(() =>
      loadPublicConfig({
        MODE: "production",
        VITE_API_BASE_URL: "https://user:secret@api.bcm.test/api",
      }),
    ).toThrow("must not contain embedded credentials");
    expect(() =>
      loadPublicConfig({
        MODE: "production",
        VITE_API_BASE_URL: "file:///api",
      }),
    ).toThrow("must use HTTP or HTTPS");
  });
});
