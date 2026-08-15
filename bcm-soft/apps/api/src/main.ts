import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { loadServerConfig } from "./config/server-config";

async function bootstrap(): Promise<void> {
  const config = loadServerConfig();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");

  await app.listen(config.port);
}

void bootstrap();
