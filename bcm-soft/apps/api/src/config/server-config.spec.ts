import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./server-config";

describe("loadServerConfig", () => {
  it("returns typed immutable configuration for valid server values", () => {
    const config = loadServerConfig({
      NODE_ENV: "production",
      PORT: "3000",
    });

    expect(config).toEqual({ environment: "production", port: 3000 });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("rejects a missing required runtime environment", () => {
    expect(() => loadServerConfig({ PORT: "3000" })).toThrow(
      "Invalid server configuration: NODE_ENV is required.",
    );
  });

  it("rejects an invalid port without exposing its value", () => {
    const invalidValue = "do-not-print-this-value";

    expect(() =>
      loadServerConfig({ NODE_ENV: "production", PORT: invalidValue }),
    ).toThrow("Invalid server configuration: PORT must be an integer.");

    try {
      loadServerConfig({ NODE_ENV: "production", PORT: invalidValue });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);

      if (!(error instanceof Error)) {
        throw error;
      }

      expect(error.message).not.toContain(invalidValue);
    }
  });

  it("uses an ephemeral port only when running tests", () => {
    expect(loadServerConfig({ NODE_ENV: "test" })).toEqual({
      environment: "test",
      port: 0,
    });

    expect(() => loadServerConfig({ NODE_ENV: "production" })).toThrow(
      "Invalid server configuration: PORT is required.",
    );
  });
});
