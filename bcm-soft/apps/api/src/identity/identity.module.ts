import { type DynamicModule, Module, type Provider } from "@nestjs/common";

import type { ServerConfig } from "../config/server-config.js";
import { PrismaClientLifecycle } from "../infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../infrastructure/identifiers/uuid-v7.js";
import type { PinoLoggerAdapter } from "../observability/pino-logger.adapter.js";
import { CredentialAuthenticator } from "./application/credential-authenticator.js";
import type { CredentialRepository } from "./application/credential-repository.js";
import type { IdentityAudit } from "./application/identity-audit.js";
import { LoginUseCase } from "./application/login-use-case.js";
import { LogoutUseCase } from "./application/logout-use-case.js";
import type { PasswordHasher } from "./application/password-hasher.js";
import type { SessionRepository } from "./application/session-repository.js";
import { SessionBootstrapUseCase } from "./application/session-bootstrap-use-case.js";
import { SessionService } from "./application/session-service.js";
import type { SessionTokenService } from "./application/session-token-service.js";
import type { Clock } from "./application/clock.js";
import { Argon2PasswordHasher } from "./infrastructure/argon2-password-hasher.js";
import { NodeSessionTokenService } from "./infrastructure/node-session-token-service.js";
import { PinoIdentityAudit } from "./infrastructure/pino-identity-audit.js";
import { PrismaCredentialRepository } from "./infrastructure/prisma-credential-repository.js";
import { PrismaSessionRepository } from "./infrastructure/prisma-session-repository.js";
import { SystemClock } from "./infrastructure/system-clock.js";
import { AuthController } from "./presentation/auth.controller.js";
import { SessionCookieCodec } from "./presentation/session-cookie-codec.js";

const CLOCK = Symbol("Clock");
const CREDENTIAL_REPOSITORY = Symbol("CredentialRepository");
const IDENTITY_AUDIT = Symbol("IdentityAudit");
const PASSWORD_HASHER = Symbol("PasswordHasher");
const SESSION_REPOSITORY = Symbol("SessionRepository");
const SESSION_TOKEN_SERVICE = Symbol("SessionTokenService");

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
        provide: PASSWORD_HASHER,
        useFactory: () => new Argon2PasswordHasher(),
      },
      {
        provide: SESSION_TOKEN_SERVICE,
        useFactory: () => new NodeSessionTokenService(),
      },
      {
        provide: CREDENTIAL_REPOSITORY,
        inject: [PrismaClientLifecycle],
        useFactory: (lifecycle: PrismaClientLifecycle): CredentialRepository =>
          new PrismaCredentialRepository(lifecycle.client),
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
      {
        provide: CredentialAuthenticator,
        inject: [PASSWORD_HASHER],
        useFactory: (passwordHasher: PasswordHasher) =>
          new CredentialAuthenticator(passwordHasher),
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
        provide: LoginUseCase,
        inject: [
          CREDENTIAL_REPOSITORY,
          CredentialAuthenticator,
          PASSWORD_HASHER,
          SessionService,
          CLOCK,
          IDENTITY_AUDIT,
        ],
        useFactory: (
          credentials: CredentialRepository,
          authenticator: CredentialAuthenticator,
          passwordHasher: PasswordHasher,
          sessions: SessionService,
          clock: Clock,
          audit: IdentityAudit,
        ) =>
          new LoginUseCase(
            credentials,
            authenticator,
            passwordHasher,
            sessions,
            clock,
            audit,
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
        inject: [SessionService],
        useFactory: (sessions: SessionService) =>
          new SessionBootstrapUseCase(sessions),
      },
      {
        provide: SessionCookieCodec,
        inject: [SESSION_TOKEN_SERVICE],
        useFactory: (tokens: SessionTokenService) =>
          new SessionCookieCodec(config.sessionCookie, tokens),
      },
    ];

    return {
      module: IdentityModule,
      controllers: [AuthController],
      providers,
    };
  }
}
