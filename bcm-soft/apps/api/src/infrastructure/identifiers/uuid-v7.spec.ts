import { validate as validateUuid, version as uuidVersion } from "uuid";
import { describe, expect, it } from "vitest";

import { generateUuidV7 } from "./uuid-v7.js";

describe("UUIDv7 identifier generator", () => {
  it("generates an RFC-compatible version 7 UUID with the RFC variant", () => {
    const identifier = generateUuidV7();

    expect(validateUuid(identifier)).toBe(true);
    expect(uuidVersion(identifier)).toBe(7);
    expect(identifier).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("does not repeat identifiers within a representative generation batch", () => {
    const identifiers = Array.from({ length: 1_024 }, generateUuidV7);

    expect(new Set(identifiers).size).toBe(identifiers.length);
  });
});
