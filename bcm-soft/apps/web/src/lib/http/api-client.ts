import type { ZodType } from "zod";

import { ApiContractError, apiErrorFromResponse } from "./api-error";

export type RequestClassification = "public" | "authenticated-mutation";

type ApiClientOptions = Readonly<{
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  onAuthenticationRequired?: () => Promise<void>;
}>;

type RequestOptions = Readonly<{
  method?: "GET" | "POST";
  classification: RequestClassification;
  body?: unknown;
  csrfToken?: string;
}>;

export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #onAuthenticationRequired: (() => Promise<void>) | undefined;

  constructor(options: ApiClientOptions) {
    this.#baseUrl = options.baseUrl;
    this.#fetch =
      options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.#onAuthenticationRequired = options.onAuthenticationRequired;
  }

  async requestJson<T>(
    path: `/${string}`,
    schema: ZodType<T>,
    options: RequestOptions,
  ): Promise<T> {
    const response = await this.request(path, options);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiContractError("The API returned invalid JSON.");
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiContractError(
        "The API response did not match its contract.",
      );
    }
    return parsed.data;
  }

  async requestNoContent(
    path: `/${string}`,
    options: RequestOptions,
  ): Promise<void> {
    const response = await this.request(path, options);
    if (response.status !== 204) {
      throw new ApiContractError(
        "The API returned an unexpected success status.",
      );
    }
  }

  private async request(
    path: `/${string}`,
    options: RequestOptions,
  ): Promise<Response> {
    const headers = new Headers({ Accept: "application/json" });
    let body: string | undefined;

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    if (options.classification === "authenticated-mutation") {
      if (options.csrfToken === undefined || options.csrfToken.length === 0) {
        throw new ApiContractError(
          "An authenticated mutation requires a CSRF token.",
        );
      }
      headers.set("X-CSRF-Token", options.csrfToken);
    }

    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      ...(body === undefined ? {} : { body }),
    });

    if (response.ok) return response;

    const error = await apiErrorFromResponse(response);
    if (
      options.classification === "authenticated-mutation" &&
      error.status === 401 &&
      error.code === "AUTHENTICATION_REQUIRED"
    ) {
      await this.#onAuthenticationRequired?.();
    }
    throw error;
  }
}
