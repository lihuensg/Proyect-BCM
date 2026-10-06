import { type DynamicModule, Module, type Provider } from "@nestjs/common";

import type { ServerConfig } from "../config/server-config.js";
import { PrismaClientLifecycle } from "../infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../infrastructure/identifiers/uuid-v7.js";
import type { PinoLoggerAdapter } from "../observability/pino-logger.adapter.js";
import type { Clock } from "./application/clock.js";
import {
  type ExternalIdentityProvider,
  type ExternalIdentityRepository,
  ExternalLoginUseCase,
} from "./application/external-login-use-case.js";
import type { IdentityAudit } from "./application/identity-audit.js";
import { LocalNetworkRateLimiter } from "./application/local-network-rate-limiter.js";
import { LogoutUseCase } from "./application/logout-use-case.js";
import { SessionBootstrapUseCase } from "./application/session-bootstrap-use-case.js";
import type { SessionRepository } from "./application/session-repository.js";
import { SessionService } from "./application/session-service.js";
import type { SessionTokenService } from "./application/session-token-service.js";
import type { ExternalAccountDirectory } from "./application/user-provisioning.js";
import { Auth0ManagementDirectory } from "./infrastructure/auth0-management-directory.js";
import { Auth0OidcProvider } from "./infrastructure/auth0-oidc-provider.js";
import { NodeCsrfTokenService } from "./infrastructure/node-csrf-token-service.js";
import { NodeRateLimitFingerprint } from "./infrastructure/node-rate-limit-fingerprint.js";
import { NodeSessionTokenService } from "./infrastructure/node-session-token-service.js";
import { PinoIdentityAudit } from "./infrastructure/pino-identity-audit.js";
import { PrismaExternalIdentityRepository } from "./infrastructure/prisma-external-identity-repository.js";
import { PrismaSessionRepository } from "./infrastructure/prisma-session-repository.js";
import { SystemClock } from "./infrastructure/system-clock.js";
import { AuthController } from "./presentation/auth.controller.js";
import {
  AUTH0_CONFIG,
  EXTERNAL_IDENTITY_PROVIDER,
  ExternalAuthController,
} from "./presentation/external-auth.controller.js";
import { ExternalLoginTransactionCodec } from "./presentation/external-login-transaction-codec.js";
import { SessionCookieCodec } from "./presentation/session-cookie-codec.js";
import { StateChangeGuard } from "./presentation/state-change.guard.js";
import { TrustedOriginValidator } from "./presentation/trusted-origin-validator.js";

export const EXTERNAL_ACCOUNT_DIRECTORY = Symbol("ExternalAccountDirectory");

const CLOCK = Symbol("Clock");
const IDENTITY_AUDIT = Symbol("IdentityAudit");
const SESSION_REPOSITORY = Symbol("SessionRepository");
const SESSION_TOKEN_SERVICE = Symbol("SessionTokenService");
const EXTERNAL_IDENTITY_REPOSITORY = Symbol("ExternalIdentityRepository");

@Module({})
export class IdentityModule {
  static register(
    config: ServerConfig,
    logger: PinoLoggerAdapter,
  ): DynamicModule {
    const providers: Provider[] = [
      {
        provide: PrismaClientLifecycle,
        useFactory: () => new PrismaClientLifecycle(config.database.runtimeUrl),
      },
      { provide: CLOCK, useFactory: () => new SystemClock() },
      {
        provide: SESSION_TOKEN_SERVICE,
        useFactory: () => new NodeSessionTokenService(),
      },
      {
        provide: SESSION_REPOSITORY,
        inject: [PrismaClientLifecycle],
        useFactory: (lifecycle: PrismaClientLifecycle): SessionRepository =>
          new PrismaSessionRepository(lifecycle.client),
      },
      {
        provide: IDENTITY_AUDIT,
        useFactory: (): IdentityAudit => new PinoIdentityAudit(logger),
      },
      { provide: PinoIdentityAudit, useExisting: IDENTITY_AUDIT },
      {
        provide: NodeCsrfTokenService,
        useFactory: () => new NodeCsrfTokenService(config.security.csrfHmacKey),
      },
      {
        provide: TrustedOriginValidator,
        useFactory: () =>
          new TrustedOriginValidator(config.security.trustedOrigins),
      },
      {
        provide: LocalNetworkRateLimiter,
        inject: [CLOCK],
        useFactory: (clock: Clock) =>
          new LocalNetworkRateLimiter(
            new NodeRateLimitFingerprint(config.security.rateLimitHmacKey),
            clock,
            config.security.networkRateLimit,
          ),
      },
      {
        provide: SessionService,
        inject: [SESSION_REPOSITORY, SESSION_TOKEN_SERVICE, CLOCK],
        useFactory: (
          repository: SessionRepository,
          tokens: SessionTokenService,
          clock: Clock,
        ) =>
          new SessionService(
            repository,
            tokens,
            clock,
            generateUuidV7,
            config.session,
          ),
      },
      {
        provide: LogoutUseCase,
        inject: [SessionService, IDENTITY_AUDIT],
        useFactory: (sessions: SessionService, audit: IdentityAudit) =>
          new LogoutUseCase(sessions, audit),
      },
      {
        provide: SessionBootstrapUseCase,
        inject: [SessionService, NodeCsrfTokenService],
        useFactory: (
          sessions: SessionService,
          csrfTokens: NodeCsrfTokenService,
        ) => new SessionBootstrapUseCase(sessions, csrfTokens),
      },
      {
        provide: SessionCookieCodec,
        inject: [SESSION_TOKEN_SERVICE],
        useFactory: (tokens: SessionTokenService) =>
          new SessionCookieCodec(config.sessionCookie, tokens),
      },
      { provide: AUTH0_CONFIG, useValue: config.auth0 },
      {
        provide: EXTERNAL_IDENTITY_PROVIDER,
        useFactory: (): ExternalIdentityProvider =>
          new Auth0OidcProvider(config.auth0),
      },
      {
        provide: EXTERNAL_ACCOUNT_DIRECTORY,
        useFactory: (): ExternalAccountDirectory =>
          new Auth0ManagementDirectory(config.auth0),
      },
      {
        provide: EXTERNAL_IDENTITY_REPOSITORY,
        inject: [PrismaClientLifecycle],
        useFactory: (
          lifecycle: PrismaClientLifecycle,
        ): ExternalIdentityRepository =>
          new PrismaExternalIdentityRepository(lifecycle.client),
      },
      {
        provide: ExternalLoginUseCase,
        inject: [
          EXTERNAL_IDENTITY_PROVIDER,
          EXTERNAL_IDENTITY_REPOSITORY,
          SessionService,
          PinoIdentityAudit,
        ],
        useFactory: (
          provider: ExternalIdentityProvider,
          identities: ExternalIdentityRepository,
          sessions: SessionService,
          audit: PinoIdentityAudit,
        ) => new ExternalLoginUseCase(provider, identities, sessions, audit),
      },
      {
        provide: ExternalLoginTransactionCodec,
        inject: [CLOCK],
        useFactory: (clock: Clock) =>
          new ExternalLoginTransactionCodec(
            config.sessionCookie,
            config.security.csrfHmacKey,
            clock,
          ),
      },
      StateChangeGuard,
    ];

    return {
      module: IdentityModule,
      controllers: [AuthController, ExternalAuthController],
      providers,
      exports: [
        PrismaClientLifecycle,
        SessionService,
        SessionCookieCodec,
        PinoIdentityAudit,
        // StateChangeGuard runs in consumer modules and needs these there.
        TrustedOriginValidator,
        NodeCsrfTokenService,
        LocalNetworkRateLimiter,
        StateChangeGuard,
        EXTERNAL_ACCOUNT_DIRECTORY,
      ],
    };
  }
}
