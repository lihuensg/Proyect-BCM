import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";

import type { PinoLoggerAdapter } from "./pino-logger.adapter";
import type { RequestContext } from "./request-context";
import { SafeHttpException } from "./safe-http-exception";

type SafeErrorResponse = Readonly<{
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
}>;

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: PinoLoggerAdapter,
    private readonly requestContext: RequestContext,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const context = host.switchToHttp();
    const requestId = this.requestContext.getRequestId() ?? "unknown";
    const safeError = this.toSafeError(exception, requestId);

    if (!(exception instanceof SafeHttpException)) {
      this.logger.record("error", "http.request.failed", {
        statusCode: safeError.statusCode,
        errorName:
          exception instanceof Error ? exception.name : "UnknownException",
      });
    }

    httpAdapter.reply(context.getResponse(), safeError, safeError.statusCode);
  }

  private toSafeError(
    exception: unknown,
    requestId: string,
  ): SafeErrorResponse {
    if (exception instanceof SafeHttpException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.safeMessage,
        requestId,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();

      return {
        statusCode,
        code: `HTTP_${statusCode}`,
        message: "Request failed.",
        requestId,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      requestId,
    };
  }
}
