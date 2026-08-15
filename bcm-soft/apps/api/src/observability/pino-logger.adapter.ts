import type { LoggerService } from "@nestjs/common";
import pino, {
  type DestinationStream,
  type Level,
  type Logger,
  type LoggerOptions,
} from "pino";

import type { ServerConfig } from "../config/server-config";
import type { RequestContext } from "./request-context";

export type LogFields = Readonly<Record<string, unknown>>;

export type LoggerAdapterOptions = Readonly<{
  destination?: DestinationStream;
  level?: Level | "silent";
}>;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "session",
  "secret",
  "apikey",
]);

const PINO_REDACTION_PATHS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "session",
  "secret",
  "apiKey",
  "headers.authorization",
  "headers.cookie",
  "headers.set-cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[-_]/g, "");
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return { name: value.name };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      sanitized[key] = SENSITIVE_KEYS.has(normalizeKey(key))
        ? REDACTED
        : sanitizeValue(nestedValue, seen);
    }

    return sanitized;
  }

  return value;
}

function sanitizeFields(fields: LogFields): Record<string, unknown> {
  return sanitizeValue(fields, new WeakSet()) as Record<string, unknown>;
}

function defaultLevel(
  environment: ServerConfig["environment"],
): Level | "silent" {
  switch (environment) {
    case "development":
      return "debug";
    case "test":
      return "silent";
    case "production":
      return "info";
  }
}

export class PinoLoggerAdapter implements LoggerService {
  private readonly logger: Logger;

  constructor(
    config: ServerConfig,
    private readonly requestContext: RequestContext,
    options: LoggerAdapterOptions = {},
  ) {
    const loggerOptions: LoggerOptions = {
      base: {
        service: "bcm-soft-api",
        environment: config.environment,
      },
      level: options.level ?? defaultLevel(config.environment),
      redact: {
        paths: PINO_REDACTION_PATHS,
        censor: REDACTED,
      },
    };

    this.logger = options.destination
      ? pino(loggerOptions, options.destination)
      : pino(loggerOptions);
  }

  record(
    level: Level,
    event: string,
    fields: LogFields = {},
    message?: string,
  ): void {
    const requestId = this.requestContext.getRequestId();
    const bindings = sanitizeFields({
      ...fields,
      event,
      ...(requestId === undefined ? {} : { requestId }),
    });

    this.logger[level](bindings, message);
  }

  log(message: unknown, ...optionalParameters: unknown[]): void {
    this.nestLog("info", message, optionalParameters);
  }

  error(message: unknown, ...optionalParameters: unknown[]): void {
    this.nestLog("error", message, optionalParameters);
  }

  warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.nestLog("warn", message, optionalParameters);
  }

  debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.nestLog("debug", message, optionalParameters);
  }

  verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.nestLog("debug", message, optionalParameters);
  }

  fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.nestLog("fatal", message, optionalParameters);
  }

  private nestLog(
    level: Level,
    message: unknown,
    optionalParameters: readonly unknown[],
  ): void {
    this.record(level, "framework.log", {
      context: optionalParameters.at(-1),
      message,
    });
  }
}
