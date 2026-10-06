import { type DynamicModule, Module, type Provider } from "@nestjs/common";

import type { ServerConfig } from "../config/server-config.js";
import {
  EXTERNAL_ACCOUNT_DIRECTORY,
  IdentityModule,
} from "../identity/identity.module.js";
import type { ExternalAccountDirectory } from "../identity/application/user-provisioning.js";
import { PinoIdentityAudit } from "../identity/infrastructure/pino-identity-audit.js";
import { PrismaUserProvisioningRepository } from "../identity/infrastructure/prisma-user-provisioning-repository.js";
import { generateUuidV7 } from "../infrastructure/identifiers/uuid-v7.js";
import { InitialSetup } from "./application/initial-setup.js";
import { MembershipAdministration } from "./application/membership-administration.js";
import { PrismaInitialSetupRepository } from "./infrastructure/prisma-initial-setup-repository.js";
import {
  SETUP_AUDIT,
  SETUP_TOKEN,
  SetupController,
} from "./presentation/setup.controller.js";
import {
  PrismaAuditRecordWriter,
  PrismaOrganizationMembershipRepository,
} from "./infrastructure/prisma-membership-administration-repositories.js";
import {
  MEMBERSHIP_HTTP_MAPPER,
  MembershipsController,
} from "./presentation/memberships.controller.js";
import { TenantAuthorizationHttpMapper } from "./presentation/tenant-authorization-http-mapper.js";
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
            (transaction, organizationId, lease): TenantRuntimeRepositories =>
              Object.freeze({
                memberships: new PrismaOrganizationMembershipRepository(
                  transaction,
                  organizationId,
                  lease,
                ),
                // Identity-owned adapter bound to the same transaction.
                users: new PrismaUserProvisioningRepository(transaction, lease),
                audit: new PrismaAuditRecordWriter(
                  transaction,
                  organizationId,
                  lease,
                ),
              }),
          ),
      },
      {
        provide: TENANT_PERSISTENCE_SCOPE,
        useExisting: PrismaTenantPersistenceScope,
      },
      TenantAuthorityHttpBoundary,
      TenantAuthorityGuard,
      {
        provide: MembershipAdministration,
        inject: [
          TENANT_PERSISTENCE_SCOPE,
          EXTERNAL_ACCOUNT_DIRECTORY,
          TENANCY_CLOCK,
          PinoIdentityAudit,
        ],
        useFactory: (
          scope: TenantPersistenceScope<TenantRuntimeRepositories>,
          accounts: ExternalAccountDirectory,
          clock: SystemClock,
          audit: PinoIdentityAudit,
        ) =>
          new MembershipAdministration(
            scope,
            accounts,
            clock,
            generateUuidV7,
            audit,
          ),
      },
      { provide: SETUP_TOKEN, useValue: config.setupToken },
      { provide: SETUP_AUDIT, useExisting: PinoIdentityAudit },
      {
        provide: InitialSetup,
        inject: [
          PrismaClientLifecycle,
          EXTERNAL_ACCOUNT_DIRECTORY,
          TENANCY_CLOCK,
          PinoIdentityAudit,
        ],
        useFactory: (
          lifecycle: PrismaClientLifecycle,
          accounts: ExternalAccountDirectory,
          clock: SystemClock,
          audit: PinoIdentityAudit,
        ) =>
          new InitialSetup(
            new PrismaInitialSetupRepository(lifecycle.client),
            accounts,
            clock,
            generateUuidV7,
            audit,
          ),
      },
      {
        provide: MEMBERSHIP_HTTP_MAPPER,
        useFactory: () => new TenantAuthorizationHttpMapper(logger),
      },
    ];

    return {
      module: TenancyModule,
      controllers: [MembershipsController, SetupController],
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
