import { HttpException } from "@nestjs/common";

export type SafeHttpExceptionDetails = Readonly<{
  authorizationState: "stale";
}>;

function allowlistedDetails(
  details: SafeHttpExceptionDetails | undefined,
): SafeHttpExceptionDetails | undefined {
  if (details === undefined) return undefined;

  if (
    details !== null &&
    typeof details === "object" &&
    !Array.isArray(details) &&
    Object.keys(details).length === 1 &&
    Object.hasOwn(details, "authorizationState") &&
    details.authorizationState === "stale"
  ) {
    return Object.freeze({ authorizationState: "stale" });
  }

  throw new Error("Unsupported safe HTTP error details.");
}

export class SafeHttpException extends HttpException {
  readonly details: SafeHttpExceptionDetails | undefined;

  constructor(
    status: number,
    readonly code: string,
    readonly safeMessage: string,
    details?: SafeHttpExceptionDetails,
  ) {
    super(safeMessage, status);
    this.details = allowlistedDetails(details);
  }
}
