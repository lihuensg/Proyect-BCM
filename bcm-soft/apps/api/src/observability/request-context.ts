import { AsyncLocalStorage } from "node:async_hooks";

type RequestContextStore = Readonly<{
  requestId: string;
}>;

export class RequestContext {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(requestId: string, callback: () => T): T {
    return this.storage.run({ requestId }, callback);
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }
}
