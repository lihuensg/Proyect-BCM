export const PASSWORD_MIN_CODE_POINTS = 15;
export const PASSWORD_MAX_CODE_POINTS = 128;

export type PasswordPolicyErrorCode =
  "PASSWORD_INVALID_TYPE" | "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG";

export class PasswordPolicyError extends Error {
  override readonly name = "PasswordPolicyError";

  constructor(readonly code: PasswordPolicyErrorCode) {
    super("Password does not satisfy the password policy.");
  }
}

export function assertPasswordPolicy(
  password: unknown,
): asserts password is string {
  if (typeof password !== "string") {
    throw new PasswordPolicyError("PASSWORD_INVALID_TYPE");
  }

  let codePointLength = 0;
  const codePoints = password[Symbol.iterator]();

  while (!codePoints.next().done) {
    codePointLength += 1;

    if (codePointLength > PASSWORD_MAX_CODE_POINTS) {
      throw new PasswordPolicyError("PASSWORD_TOO_LONG");
    }
  }

  if (codePointLength < PASSWORD_MIN_CODE_POINTS) {
    throw new PasswordPolicyError("PASSWORD_TOO_SHORT");
  }
}
