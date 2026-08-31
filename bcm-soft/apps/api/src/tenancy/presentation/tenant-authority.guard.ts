import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";

import { TenantAuthorityHttpBoundary } from "./tenant-authority-http-boundary.js";
import {
  attachTenantContext,
  hasTenantContext,
  type TenantContextRequest,
} from "./tenant-request-context.js";

type TenantHttpRequest = TenantContextRequest &
  Readonly<{
    headers: Readonly<Record<string, string | string[] | undefined>>;
  }>;

@Injectable()
export class TenantAuthorityGuard implements CanActivate {
  constructor(private readonly boundary: TenantAuthorityHttpBoundary) {}

  async canActivate(executionContext: ExecutionContext): Promise<true> {
    const request = executionContext
      .switchToHttp()
      .getRequest<TenantHttpRequest>();
    if (hasTenantContext(request)) return true;

    const cookieHeader = request.headers.cookie;
    const tenantContext = await this.boundary.resolve(
      typeof cookieHeader === "string" ? cookieHeader : undefined,
    );

    attachTenantContext(request, tenantContext);
    return true;
  }
}
