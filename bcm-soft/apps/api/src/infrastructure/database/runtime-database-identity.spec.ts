import { describe, expect, it } from "vitest";

import {
  assertSafeRuntimeIdentityProfile,
  UnsafeRuntimeDatabaseIdentityError,
} from "./runtime-database-identity.js";

const safeProfile = {
  currentUser: "runtime",
  isSuperuser: false,
  bypassesRowLevelSecurity: false,
  ownsDatabase: false,
  ownsApplicationSchema: false,
};

describe("runtime database identity", () => {
  it("accepts a restricted runtime identity", () => {
    expect(() =>
      assertSafeRuntimeIdentityProfile(safeProfile, "runtime"),
    ).not.toThrow();
  });

  it("fails closed when current_user differs from the configured login", () => {
    expect(() =>
      assertSafeRuntimeIdentityProfile(safeProfile, "different-runtime"),
    ).toThrow(UnsafeRuntimeDatabaseIdentityError);
  });

  it.each([
    "isSuperuser",
    "bypassesRowLevelSecurity",
    "ownsDatabase",
    "ownsApplicationSchema",
  ] as const)("fails closed when %s is true", (property) => {
    expect(() =>
      assertSafeRuntimeIdentityProfile({ ...safeProfile, [property]: true }),
    ).toThrow(UnsafeRuntimeDatabaseIdentityError);
  });
});
