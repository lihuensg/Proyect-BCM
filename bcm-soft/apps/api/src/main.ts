import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { loadServerConfig } from "./config/server-config.js";
import { configureCors } from "./config/cors.js";
import {
  configureObservability,
  createObservability,
} from "./observability/observability.js";

async function bootstrap(): Promise<void> {
  const config = loadServerConfig();
  const observability = createObservability(config);
  const app = await NestFactory.create(
    AppModule.register(config, observability.logger),
    {
      logger: observability.logger,
    },
  );

  app.setGlobalPrefix("api");
  configureCors(app, config);
  configureObservability(app, observability);

  await app.listen(config.port);
}

void bootstrap();
