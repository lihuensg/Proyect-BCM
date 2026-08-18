export const EMAIL_MAX_CODE_POINTS = 254;

export type EmailAddressErrorCode =
  | "EMAIL_INVALID_TYPE"
  | "EMAIL_EMPTY"
  | "EMAIL_TOO_LONG"
  | "EMAIL_INVALID_FORMAT";

export class EmailAddressError extends Error {
  override readonly name = "EmailAddressError";

  constructor(readonly code: EmailAddressErrorCode) {
    super("Email does not satisfy the identity email contract.");
  }
}

export function normalizeIdentityEmail(email: unknown): string {
  if (typeof email !== "string") {
    throw new EmailAddressError("EMAIL_INVALID_TYPE");
  }

  const trimmed = email.trim();
  if (trimmed.length === 0) {
    throw new EmailAddressError("EMAIL_EMPTY");
  }

  if ([...trimmed].length > EMAIL_MAX_CODE_POINTS) {
    throw new EmailAddressError("EMAIL_TOO_LONG");
  }

  const separatorIndex = trimmed.indexOf("@");
  if (
    separatorIndex <= 0 ||
    separatorIndex !== trimmed.lastIndexOf("@") ||
    separatorIndex === trimmed.length - 1 ||
    /\s/u.test(trimmed)
  ) {
    throw new EmailAddressError("EMAIL_INVALID_FORMAT");
  }

  return trimmed.toLowerCase();
}
