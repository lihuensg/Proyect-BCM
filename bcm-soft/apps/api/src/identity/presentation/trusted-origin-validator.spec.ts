import { describe, expect, it } from "vitest";

import {
  readSingleHeader,
  TrustedOriginValidator,
} from "./trusted-origin-validator.js";

function request(...headers: string[]) {
  return { rawHeaders: headers };
}

describe("TrustedOriginValidator", () => {
  const validator = new TrustedOriginValidator(["https://app.bcm.test"]);

  it("accepts one exact Origin or an absolute trusted Referer fallback", () => {
    expect(validator.accepts(request("Origin", "https://app.bcm.test"))).toBe(
      true,
    );
    expect(
      validator.accepts(request("Referer", "https://app.bcm.test/screen?q=1")),
    ).toBe(true);
  });

  it.each([
    request(),
    request("Origin", "null"),
    request("Origin", "http://app.bcm.test"),
    request("Origin", "https://app.bcm.test:444"),
    request("Origin", "https://evilapp.bcm.test"),
    request("Origin", "https://app.bcm.test.evil"),
    request("Origin", "https://app.bcm.test", "Origin", "https://app.bcm.test"),
    request("Origin", "https://evil.test", "Referer", "https://app.bcm.test/"),
    request("Referer", "/relative"),
    request("Referer", "https://evil.test/login"),
  ])(
    "fails closed for absent, malformed, duplicate, or untrusted provenance",
    (candidate) => {
      expect(validator.accepts(candidate)).toBe(false);
    },
  );

  it("requires exactly one security header value", () => {
    expect(
      readSingleHeader(request("X-CSRF-Token", "v1.token"), "x-csrf-token"),
    ).toBe("v1.token");
    expect(
      readSingleHeader(
        request("X-CSRF-Token", "v1.first", "x-csrf-token", "v1.second"),
        "x-csrf-token",
      ),
    ).toBeNull();
  });
});
