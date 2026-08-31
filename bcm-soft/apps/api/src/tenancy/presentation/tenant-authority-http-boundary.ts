import { Inject, Injectable } from "@nestjs/common";

import { SessionService } from "../../identity/application/session-service.js";
import { SessionCookieCodec } from "../../identity/presentation/session-cookie-codec.js";
import type { AuthenticatedIdentity } from "../application/authenticated-identity.js";
import type {
  TenantAuthorityResolver,
  TenantContext,
} from "../application/tenant-authority.js";
import { TENANT_AUTHORITY_RESOLVER } from "../tenancy.tokens.js";
import {
  authenticationRequired,
  tenantAccessDenied,
  tenantSelectionRequired,
} from "./tenant-http-errors.js";

@Injectable()
export class TenantAuthorityHttpBoundary {
  constructor(
    @Inject(SessionCookieCodec)
    private readonly cookies: Pick<SessionCookieCodec, "parse">,
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, "validateSession">,
    @Inject(TENANT_AUTHORITY_RESOLVER)
    private readonly authority: TenantAuthorityResolver,
  ) {}

  async resolve(cookieHeader: string | undefined): Promise<TenantContext> {
    const rawToken = this.cookies.parse(cookieHeader);
    if (rawToken === null) throw authenticationRequired();

    const session = await this.sessions.validateSession(rawToken);
    if (session.status === "invalid") throw authenticationRequired();

    const identity: AuthenticatedIdentity = Object.freeze({
      userId: session.userId,
      sessionId: session.sessionId,
    });
    const resolution = await this.authority.resolve(identity);

    switch (resolution.status) {
      case "resolved":
        return resolution.context;
      case "selection-required":
        throw tenantSelectionRequired();
      case "auto-selection-required":
      case "denied":
        throw tenantAccessDenied();
    }
  }
}
