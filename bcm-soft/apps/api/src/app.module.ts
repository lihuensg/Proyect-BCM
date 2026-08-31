import { type DynamicModule, Module } from "@nestjs/common";

import type { ServerConfig } from "./config/server-config.js";
import { HealthController } from "./health/health.controller.js";
import type { PinoLoggerAdapter } from "./observability/pino-logger.adapter.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

@Module({ controllers: [HealthController] })
export class AppModule {
  static register(
    config: ServerConfig,
    logger: PinoLoggerAdapter,
  ): DynamicModule {
    const tenancyModule = TenancyModule.register(config, logger);

    return {
      module: AppModule,
      imports: [tenancyModule],
      exports: [tenancyModule],
    };
  }
}
