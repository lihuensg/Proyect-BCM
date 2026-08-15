import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "./app.module";

describe("API foundation", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
    }
  }, 30_000);

  it("initializes the Nest application with the configured HTTP adapter", async () => {
    app = await NestFactory.create(AppModule, { logger: false });

    await app.init();

    expect(app.getHttpAdapter().getType()).toBe("express");
  }, 30_000);
});
