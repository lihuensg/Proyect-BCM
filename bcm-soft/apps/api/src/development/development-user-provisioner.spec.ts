import { describe, expect, it } from "vitest";

import {
  assertDevelopmentDatabaseTarget,
  formatDevelopmentProvisioningResult,
} from "./development-user-provisioner.js";

const LOCAL_URL =
  "postgresql://bcm_local_runtime:synthetic@127.0.0.1:55432/bcm_soft_local";

describe("development user provisioning boundary", () => {
  it("rejects non-development and remote database targets", () => {
    expect(() =>
      assertDevelopmentDatabaseTarget({
        NODE_ENV: "production",
        DATABASE_URL: LOCAL_URL,
      }),
    ).toThrow("NODE_ENV=development");
    expect(() =>
      assertDevelopmentDatabaseTarget({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://runtime:synthetic@database.example.com/bcm_soft",
      }),
    ).toThrow("loopback PostgreSQL target");
  });

  it.each(["127.0.0.1", "localhost", "[::1]"])(
    "accepts the explicit loopback host %s",
    (host) => {
      expect(
        assertDevelopmentDatabaseTarget({
          NODE_ENV: "development",
          DATABASE_URL: `postgresql://runtime:synthetic@${host}:55432/bcm_soft_local`,
        }).hostname,
      ).toBe(host === "[::1]" ? "[::1]" : host);
    },
  );

  it("formats only a safe outcome without password or hash material", () => {
    const message = formatDevelopmentProvisioningResult({
      status: "created",
      email: "dev.user@bcm.local",
      userId: "019c8f52-97d3-7000-8000-000000000001",
    });

    expect(message).toBe("Development user created: dev.user@bcm.local");
    expect(message).not.toContain("password");
    expect(message).not.toContain("argon2");
    expect(message).not.toContain("019c8f52");
  });
});
