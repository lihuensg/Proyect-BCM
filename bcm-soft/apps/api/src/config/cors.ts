import type { INestApplication } from "@nestjs/common";

import type { ServerConfig } from "./server-config.js";

export function configureCors(
  app: INestApplication,
  config: ServerConfig,
): void {
  const trustedOrigins = new Set(config.security.trustedOrigins);
  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) {
      callback(null, origin === undefined || trustedOrigins.has(origin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Request-ID"],
    exposedHeaders: ["X-Request-ID", "Retry-After"],
    optionsSuccessStatus: 204,
  });
}
