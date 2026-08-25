import { z } from "zod";

const apiErrorEnvelopeSchema = z.object({
  statusCode: z.number().int(),
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1).optional(),
});

const MAX_RETRY_AFTER_SECONDS = 86_400;

export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export class ApiContractError extends Error {
  override readonly name = "ApiContractError";
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^[1-9]\d*$/u.test(value)) return undefined;

  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= MAX_RETRY_AFTER_SECONDS
    ? seconds
    : undefined;
}

export async function apiErrorFromResponse(
  response: Response,
): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const parsed = apiErrorEnvelopeSchema.safeParse(body);
  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  const retryAfterSeconds = parseRetryAfter(
    response.headers.get("retry-after"),
  );

  if (!parsed.success) {
    return new ApiError(
      response.status,
      `HTTP_${response.status}`,
      "No pudimos completar la solicitud.",
      headerRequestId,
      retryAfterSeconds,
    );
  }

  return new ApiError(
    response.status,
    parsed.data.code,
    parsed.data.message,
    parsed.data.requestId ?? headerRequestId,
    retryAfterSeconds,
  );
}
