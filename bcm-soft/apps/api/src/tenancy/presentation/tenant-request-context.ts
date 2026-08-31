import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { TenantContext } from "../application/tenant-authority.js";

const TENANT_REQUEST_CONTEXT = Symbol("TenantRequestContext");

export type TenantContextRequest = {
  [TENANT_REQUEST_CONTEXT]?: TenantContext;
};

export function attachTenantContext(
  request: TenantContextRequest,
  tenantContext: TenantContext,
): void {
  if (request[TENANT_REQUEST_CONTEXT] !== undefined) {
    throw new Error("TenantContext is already attached to this request.");
  }

  Object.defineProperty(request, TENANT_REQUEST_CONTEXT, {
    configurable: false,
    enumerable: false,
    value: tenantContext,
    writable: false,
  });
}

export function hasTenantContext(request: TenantContextRequest): boolean {
  return request[TENANT_REQUEST_CONTEXT] !== undefined;
}

export function requireTenantContext(
  request: TenantContextRequest,
): TenantContext {
  const tenantContext = request[TENANT_REQUEST_CONTEXT];
  if (tenantContext === undefined) {
    throw new Error("TenantContext is unavailable on this request.");
  }
  return tenantContext;
}

export const CurrentTenant = createParamDecorator(
  (_data: unknown, executionContext: ExecutionContext): TenantContext =>
    requireTenantContext(
      executionContext.switchToHttp().getRequest<TenantContextRequest>(),
    ),
);
