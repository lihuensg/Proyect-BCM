import type { INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";

import type { ServerConfig } from "../config/server-config";
import {
  PinoLoggerAdapter,
  type LoggerAdapterOptions,
} from "./pino-logger.adapter";
import { RequestContext } from "./request-context";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";
import { SafeHttpExceptionFilter } from "./safe-http-exception.filter";

type HttpRequest = Readonly<{
  headers: Readonly<Record<string, string | string[] | undefined>>;
  method?: string;
  route?: Readonly<{ path?: unknown }>;
}>;

type HttpResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: "finish", listener: () => void): void;
};

export type ObservabilityRuntime = Readonly<{
  logger: PinoLoggerAdapter;
  requestContext: RequestContext;
}>;

export function createObservability(
  config: ServerConfig,
  loggerOptions: LoggerAdapterOptions = {},
): ObservabilityRuntime {
  const requestContext = new RequestContext();

  return {
    logger: new PinoLoggerAdapter(config, requestContext, loggerOptions),
    requestContext,
  };
}

export function configureObservability(
  app: INestApplication,
  runtime: ObservabilityRuntime,
): void {
  app.use(
    (request: HttpRequest, response: HttpResponse, next: () => void): void => {
      const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
      const startedAt = process.hrtime.bigint();

      response.setHeader(REQUEST_ID_HEADER, requestId);
      runtime.requestContext.run(requestId, () => {
        response.once("finish", () => {
          const durationMilliseconds =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          const route =
            typeof request.route?.path === "string"
              ? request.route.path
              : undefined;

          runtime.logger.record("info", "http.request.completed", {
            method: request.method,
            statusCode: response.statusCode,
            durationMilliseconds,
            ...(route === undefined ? {} : { route }),
          });
        });

        next();
      });
    },
  );

  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new SafeHttpExceptionFilter(
      httpAdapterHost,
      runtime.logger,
      runtime.requestContext,
    ),
  );
}
