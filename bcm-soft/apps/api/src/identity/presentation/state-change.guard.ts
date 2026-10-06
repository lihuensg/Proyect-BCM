import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";

import { SafeHttpException } from "../../observability/safe-http-exception.js";
import { NodeCsrfTokenService } from "../infrastructure/node-csrf-token-service.js";
import { PinoIdentityAudit } from "../infrastructure/pino-identity-audit.js";
import { SessionCookieCodec } from "./session-cookie-codec.js";
import {
  type RawHeadersRequest,
  readSingleHeader,
  TrustedOriginValidator,
} from "./trusted-origin-validator.js";

type StateChangeRequest = RawHeadersRequest &
  Readonly<{
    headers: Readonly<Record<string, string | string[] | undefined>>;
  }>;

/**
 * SECURITY.md §12 for authenticated state-changing routes: trusted
 * Origin/Referer plus the session-bound CSRF token in `x-csrf-token`. Apply it
 * after the guard that authenticates the Session.
 */
@Injectable()
export class StateChangeGuard implements CanActivate {
  constructor(
    private readonly cookies: SessionCookieCodec,
    private readonly origins: TrustedOriginValidator,
    private readonly csrfTokens: NodeCsrfTokenService,
    private readonly audit: PinoIdentityAudit,
  ) {}

  canActivate(executionContext: ExecutionContext): true {
    const request = executionContext
      .switchToHttp()
      .getRequest<StateChangeRequest>();
    if (!this.origins.accepts(request)) {
      this.audit.recordOriginRejected("tenant-command");
      throw new SafeHttpException(
        403,
        "ORIGIN_VALIDATION_FAILED",
        "El origen de la solicitud no es válido.",
      );
    }
    const cookieHeader = request.headers.cookie;
    const rawToken = this.cookies.parse(
      typeof cookieHeader === "string" ? cookieHeader : undefined,
    );
    const csrfToken = readSingleHeader(request, "x-csrf-token");
    if (
      rawToken === null ||
      csrfToken === null ||
      !this.csrfTokens.verify(rawToken, csrfToken)
    ) {
      this.audit.recordCsrfRejected("tenant-command");
      throw new SafeHttpException(
        403,
        "CSRF_VALIDATION_FAILED",
        "La validación de seguridad falló.",
      );
    }
    return true;
  }
}
