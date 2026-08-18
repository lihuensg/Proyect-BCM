import { type DynamicModule, Module } from "@nestjs/common";

import type { ServerConfig } from "./config/server-config.js";
import { HealthController } from "./health/health.controller.js";
import { IdentityModule } from "./identity/identity.module.js";
import type { PinoLoggerAdapter } from "./observability/pino-logger.adapter.js";

@Module({ controllers: [HealthController] })
export class AppModule {
  static register(
    config: ServerConfig,
    logger: PinoLoggerAdapter,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [IdentityModule.register(config, logger)],
    };
  }
}
