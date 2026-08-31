import { type DynamicModule, Module, type Provider } from "@nestjs/common";

import type { ServerConfig } from "../config/server-config.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SystemClock } from "../identity/infrastructure/system-clock.js";
import { PrismaClientLifecycle } from "../infrastructure/database/prisma-client-lifecycle.js";
import type { PinoLoggerAdapter } from "../observability/pino-logger.adapter.js";
import type { TenantPersistenceScope } from "./application/tenant-persistence-scope.js";
import { PrismaTenantAuthorityAdapter } from "./infrastructure/prisma-tenant-authority.js";
import { PrismaTenantPersistenceScope } from "./infrastructure/prisma-tenant-persistence-scope.js";
import { TenantAuthorityGuard } from "./presentation/tenant-authority.guard.js";
import { TenantAuthorityHttpBoundary } from "./presentation/tenant-authority-http-boundary.js";
import {
  TENANT_AUTHORITY_RESOLVER,
  TENANT_PERSISTENCE_SCOPE,
  type TenantRuntimeRepositories,
} from "./tenancy.tokens.js";

const TENANCY_CLOCK = Symbol("TenancyClock");
const EMPTY_TENANT_REPOSITORIES: TenantRuntimeRepositories = Object.freeze({});

@Module({})
export class TenancyModule {
  static register(
    config: ServerConfig,
    logger: PinoLoggerAdapter,
  ): DynamicModule {
    const providers: Provider[] = [
      { provide: TENANCY_CLOCK, useFactory: () => new SystemClock() },
      {
        provide: PrismaTenantAuthorityAdapter,
        inject: [PrismaClientLifecycle, TENANCY_CLOCK],
        useFactory: (
          lifecycle: PrismaClientLifecycle,
          clock: SystemClock,
        ): PrismaTenantAuthorityAdapter =>
          new PrismaTenantAuthorityAdapter(
            lifecycle.client,
            clock,
            config.session.idleTimeoutMilliseconds,
          ),
      },
      {
        provide: TENANT_AUTHORITY_RESOLVER,
        useExisting: PrismaTenantAuthorityAdapter,
      },
      {
        provide: PrismaTenantPersistenceScope,
        inject: [PrismaClientLifecycle, TENANCY_CLOCK],
        useFactory: (
          lifecycle: PrismaClientLifecycle,
          clock: SystemClock,
        ): TenantPersistenceScope<TenantRuntimeRepositories> =>
          new PrismaTenantPersistenceScope(
            lifecycle.client,
            clock,
            config.session.idleTimeoutMilliseconds,
            () => EMPTY_TENANT_REPOSITORIES,
          ),
      },
      {
        provide: TENANT_PERSISTENCE_SCOPE,
        useExisting: PrismaTenantPersistenceScope,
      },
      TenantAuthorityHttpBoundary,
      TenantAuthorityGuard,
    ];

    return {
      module: TenancyModule,
      imports: [IdentityModule.register(config, logger)],
      providers,
      exports: [
        TENANT_AUTHORITY_RESOLVER,
        TENANT_PERSISTENCE_SCOPE,
        TenantAuthorityGuard,
        TenantAuthorityHttpBoundary,
      ],
    };
  }
}
