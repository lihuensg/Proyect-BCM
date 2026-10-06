import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { validate, version } from "uuid";

import { StateChangeGuard } from "../../identity/presentation/state-change.guard.js";
import { REQUEST_ID_HEADER } from "../../observability/request-id.js";
import { SafeHttpException } from "../../observability/safe-http-exception.js";
import {
  MEMBERSHIP_LIST_MAX_LIMIT,
  MembershipAdministration,
} from "../application/membership-administration.js";
import type { TenantContext } from "../application/tenant-authority.js";
import { TenantAuthorityGuard } from "./tenant-authority.guard.js";
import { TenantAuthorizationHttpMapper } from "./tenant-authorization-http-mapper.js";
import { CurrentTenant } from "./tenant-request-context.js";

export const MEMBERSHIP_HTTP_MAPPER = Symbol("MembershipHttpMapper");

const DEFAULT_LIST_LIMIT = 50;

type HeaderReader = Readonly<{
  getHeader(name: string): number | string | string[] | undefined;
}>;

type MembershipItem = Readonly<{
  id: string;
  userId: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}>;

function invalidRequest(): SafeHttpException {
  return new SafeHttpException(
    400,
    "INVALID_REQUEST",
    "La solicitud no es válida.",
  );
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (typeof value !== "string" || !/^\d{1,3}$/u.test(value)) {
    throw invalidRequest();
  }
  const limit = Number(value);
  if (limit < 1 || limit > MEMBERSHIP_LIST_MAX_LIMIT) throw invalidRequest();
  return limit;
}

function parseCursor(value: unknown): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    !validate(value) ||
    version(value) !== 7 ||
    value !== value.toLowerCase()
  ) {
    throw invalidRequest();
  }
  return value;
}

/** Exactly `{ email, role }` as own properties; nothing else is accepted. */
function parseProvisionBody(
  body: unknown,
): Readonly<{ email: unknown; role: unknown }> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest();
  }
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, "email") ||
    !Object.hasOwn(input, "role") ||
    typeof input.email !== "string" ||
    typeof input.role !== "string"
  ) {
    throw invalidRequest();
  }
  return { email: input.email, role: input.role };
}

@Controller("organization/memberships")
@UseGuards(TenantAuthorityGuard)
export class MembershipsController {
  constructor(
    private readonly administration: MembershipAdministration,
    @Inject(MEMBERSHIP_HTTP_MAPPER)
    private readonly authorization: TenantAuthorizationHttpMapper,
  ) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: Record<string, unknown>,
  ): Promise<
    Readonly<{ items: readonly MembershipItem[]; nextCursor: string | null }>
  > {
    if (Object.keys(query).some((key) => key !== "limit" && key !== "after")) {
      throw invalidRequest();
    }
    const result = await this.administration.list(tenant, {
      limit: parseLimit(query.limit),
      afterId: parseCursor(query.after),
    });
    if (result.status !== "listed") return this.authorization.map(result);

    return {
      items: result.items.map((item) => ({
        id: item.id,
        userId: item.userId,
        email: item.email,
        role: item.role,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StateChangeGuard)
  async provision(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderReader,
  ): Promise<MembershipItem & Readonly<{ passwordSetupEmail: string }>> {
    const input = parseProvisionBody(body);
    const requestId = response.getHeader(REQUEST_ID_HEADER);
    const result = await this.administration.provision(tenant, {
      ...input,
      correlationId: typeof requestId === "string" ? requestId : null,
    });

    switch (result.status) {
      case "provisioned":
        return {
          id: result.membershipId,
          userId: result.userId,
          email: result.email,
          role: result.role,
          status: "Active",
          createdAt: result.createdAt.toISOString(),
          passwordSetupEmail: result.passwordSetupEmail,
        };
      case "invalid-email":
        throw new SafeHttpException(
          400,
          "INVALID_EMAIL",
          "El email no es válido.",
        );
      case "role-not-allowed":
        throw new SafeHttpException(
          403,
          "ROLE_NOT_ALLOWED",
          "No tenés permiso para asignar ese rol.",
        );
      case "already-member":
        throw new SafeHttpException(
          409,
          "MEMBERSHIP_EXISTS",
          "Ese email ya es miembro de la organización.",
        );
      // One code for both: which one applies is global identity state that
      // must not leak to an administrator of a single Organization.
      case "identity-conflict":
      case "user-disabled":
        throw new SafeHttpException(
          409,
          "PROVISIONING_CONFLICT",
          "No se puede dar de alta este email. Contactá a soporte.",
        );
      case "provider-unavailable":
        throw new SafeHttpException(
          503,
          "IDENTITY_PROVIDER_UNAVAILABLE",
          "No pudimos comunicarnos con el servicio de identidad. Intentá nuevamente.",
        );
      default:
        return this.authorization.map(result);
    }
  }
}
