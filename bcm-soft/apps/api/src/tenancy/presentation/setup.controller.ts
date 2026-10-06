import { createHash, timingSafeEqual } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";

import { LocalNetworkRateLimiter } from "../../identity/application/local-network-rate-limiter.js";
import { canonicalizeClientIp } from "../../identity/presentation/client-ip.js";
import {
  type RawHeadersRequest,
  TrustedOriginValidator,
} from "../../identity/presentation/trusted-origin-validator.js";
import { REQUEST_ID_HEADER } from "../../observability/request-id.js";
import { SafeHttpException } from "../../observability/safe-http-exception.js";
import { InitialSetup } from "../application/initial-setup.js";

export const SETUP_TOKEN = Symbol("SetupToken");
export const SETUP_AUDIT = Symbol("SetupAudit");

export interface SetupAudit {
  recordOriginRejected(operation: "setup"): void;
}

type SetupRequest = RawHeadersRequest &
  Readonly<{ socket: Readonly<{ remoteAddress?: string }> }>;

type SetupResponse = Readonly<{
  getHeader(name: string): number | string | string[] | undefined;
  setHeader(name: string, value: string): void;
}>;

const MAX_FIELD_LENGTH = 512;

function invalidRequest(): SafeHttpException {
  return new SafeHttpException(
    400,
    "INVALID_REQUEST",
    "La solicitud no es válida.",
  );
}

/** Exactly `{ setupToken, organizationName, ownerEmail }` as strings. */
function parseBody(body: unknown): Readonly<{
  setupToken: string;
  organizationName: string;
  ownerEmail: string;
}> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest();
  }
  const input = body as Record<string, unknown>;
  const fields = ["setupToken", "organizationName", "ownerEmail"] as const;
  if (
    Object.keys(input).length !== fields.length ||
    fields.some(
      (field) =>
        !Object.hasOwn(input, field) ||
        typeof input[field] !== "string" ||
        input[field].length > MAX_FIELD_LENGTH,
    )
  ) {
    throw invalidRequest();
  }
  return {
    setupToken: input.setupToken as string,
    organizationName: input.organizationName as string,
    ownerEmail: input.ownerEmail as string,
  };
}

/** Constant-time over equal-length digests, whatever the input lengths. */
function matchesToken(expected: string, received: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(received));
}

/**
 * One-time initial setup. Public by necessity (no User exists yet), so it is
 * gated by a server-side token, trusted Origin, and the per-IP limiter.
 */
@Controller("setup")
export class SetupController {
  constructor(
    private readonly setup: InitialSetup,
    @Inject(SETUP_TOKEN) private readonly setupToken: string | null,
    private readonly origins: TrustedOriginValidator,
    private readonly localRateLimiter: LocalNetworkRateLimiter,
    @Inject(SETUP_AUDIT) private readonly audit: SetupAudit,
  ) {}

  @Get()
  async status(): Promise<Readonly<{ required: boolean }>> {
    return { required: await this.setup.isRequired() };
  }

  @Post()
  @HttpCode(201)
  async complete(
    @Body() body: unknown,
    @Req() request: SetupRequest,
    @Res({ passthrough: true }) response: SetupResponse,
  ): Promise<
    Readonly<{
      organizationId: string;
      ownerEmail: string;
      passwordSetupEmail: string;
    }>
  > {
    if (!this.origins.accepts(request)) {
      this.audit.recordOriginRejected("setup");
      throw new SafeHttpException(
        403,
        "ORIGIN_VALIDATION_FAILED",
        "El origen de la solicitud no es válido.",
      );
    }
    const clientIp = canonicalizeClientIp(request.socket.remoteAddress);
    if (clientIp === null) throw invalidRequest();
    const limit = this.localRateLimiter.consume(clientIp);
    if (!limit.allowed) {
      response.setHeader("retry-after", String(limit.retryAfterSeconds));
      throw new SafeHttpException(
        429,
        "TOO_MANY_REQUESTS",
        "Demasiados intentos. Intentá nuevamente más tarde.",
      );
    }
    const input = parseBody(body);
    if (this.setupToken === null) {
      throw new SafeHttpException(
        503,
        "SETUP_UNAVAILABLE",
        "La configuración inicial no está habilitada en el servidor.",
      );
    }
    if (!matchesToken(this.setupToken, input.setupToken)) {
      throw new SafeHttpException(
        403,
        "SETUP_TOKEN_INVALID",
        "El código de configuración no es válido.",
      );
    }

    const requestId = response.getHeader(REQUEST_ID_HEADER);
    const result = await this.setup.complete({
      organizationName: input.organizationName,
      ownerEmail: input.ownerEmail,
      correlationId: typeof requestId === "string" ? requestId : null,
    });
    switch (result.status) {
      case "completed":
        return {
          organizationId: result.organizationId,
          ownerEmail: result.ownerEmail,
          passwordSetupEmail: result.passwordSetupEmail,
        };
      case "already-configured":
        throw new SafeHttpException(
          409,
          "SETUP_ALREADY_COMPLETED",
          "BCM SOFT ya está configurado.",
        );
      case "invalid-email":
        throw new SafeHttpException(
          400,
          "INVALID_EMAIL",
          "El email no es válido.",
        );
      case "invalid-organization-name":
        throw new SafeHttpException(
          400,
          "INVALID_ORGANIZATION_NAME",
          "El nombre de la organización no es válido.",
        );
      case "identity-conflict":
        throw new SafeHttpException(
          409,
          "PROVISIONING_CONFLICT",
          "No se puede usar este email. Contactá a soporte.",
        );
      case "provider-unavailable":
        throw new SafeHttpException(
          503,
          "IDENTITY_PROVIDER_UNAVAILABLE",
          "No pudimos comunicarnos con el servicio de identidad. Intentá nuevamente.",
        );
    }
  }
}
