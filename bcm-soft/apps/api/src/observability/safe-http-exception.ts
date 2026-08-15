import { HttpException } from "@nestjs/common";

export class SafeHttpException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage, status);
  }
}
