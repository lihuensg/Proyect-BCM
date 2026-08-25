import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { testServer } from "../../test/server";
import { ApiContractError, ApiError, parseRetryAfter } from "./api-error";
import { ApiClient } from "./api-client";

const BASE_URL = "http://localhost:3000/api";

describe("ApiClient", () => {
  it("invokes the default browser fetch with the global receiver", async () => {
    const receivers: unknown[] = [];
    vi.stubGlobal("fetch", function (this: unknown): Promise<Response> {
      receivers.push(this);
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    try {
      const client = new ApiClient({ baseUrl: BASE_URL });

      await client.requestNoContent("/health", {
        classification: "public",
      });

      expect(receivers).toEqual([globalThis]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends credentialed JSON without CSRF for a public request", async () => {
    testServer.use(
      http.post(`${BASE_URL}/auth/login`, async ({ request }) => {
        expect(request.credentials).toBe("include");
        expect(request.headers.get("accept")).toBe("application/json");
        expect(request.headers.get("content-type")).toBe("application/json");
        expect(request.headers.get("x-csrf-token")).toBeNull();
        await expect(request.json()).resolves.toEqual({
          email: "owner@bcm.test",
          password: "  exact password  ",
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const client = new ApiClient({ baseUrl: BASE_URL });

    await expect(
      client.requestNoContent("/auth/login", {
        method: "POST",
        classification: "public",
        body: {
          email: "owner@bcm.test",
          password: "  exact password  ",
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("adds CSRF only to an authenticated mutation", async () => {
    testServer.use(
      http.post(`${BASE_URL}/auth/logout`, ({ request }) => {
        expect(request.credentials).toBe("include");
        expect(request.headers.get("x-csrf-token")).toBe("v1.csrf_token");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const client = new ApiClient({ baseUrl: BASE_URL });

    await client.requestNoContent("/auth/logout", {
      method: "POST",
      classification: "authenticated-mutation",
      csrfToken: "v1.csrf_token",
    });

    await expect(
      client.requestNoContent("/auth/logout", {
        method: "POST",
        classification: "authenticated-mutation",
      }),
    ).rejects.toBeInstanceOf(ApiContractError);
  });

  it("parses a safe API error and Retry-After", async () => {
    testServer.use(
      http.post(`${BASE_URL}/auth/login`, () =>
        HttpResponse.json(
          {
            statusCode: 429,
            code: "TOO_MANY_REQUESTS",
            message: "Demasiados intentos.",
            requestId: "request-123",
          },
          { status: 429, headers: { "Retry-After": "17" } },
        ),
      ),
    );
    const client = new ApiClient({ baseUrl: BASE_URL });

    const error = await client
      .requestNoContent("/auth/login", {
        method: "POST",
        classification: "public",
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: "TOO_MANY_REQUESTS",
      requestId: "request-123",
      retryAfterSeconds: 17,
    });
  });

  it("fails safely for malformed success and error responses", async () => {
    testServer.use(
      http.get(`${BASE_URL}/malformed-success`, () =>
        HttpResponse.json({ unexpected: true }),
      ),
      http.get(`${BASE_URL}/malformed-error`, () =>
        HttpResponse.json({ internal: "do not expose" }, { status: 500 }),
      ),
    );
    const client = new ApiClient({ baseUrl: BASE_URL });

    await expect(
      client.requestJson(
        "/malformed-success",
        z.object({ ok: z.literal(true) }),
        {
          classification: "public",
        },
      ),
    ).rejects.toBeInstanceOf(ApiContractError);
    await expect(
      client.requestJson("/malformed-error", z.unknown(), {
        classification: "public",
      }),
    ).rejects.toMatchObject({
      status: 500,
      code: "HTTP_500",
      message: "No pudimos completar la solicitud.",
    });
  });

  it("never treats invalid credentials as global session loss", async () => {
    const onAuthenticationRequired = vi.fn<() => Promise<void>>(() =>
      Promise.resolve(),
    );
    testServer.use(
      http.post(`${BASE_URL}/auth/login`, () =>
        HttpResponse.json(
          {
            statusCode: 401,
            code: "INVALID_CREDENTIALS",
            message: "Las credenciales no son válidas.",
            requestId: "request-401",
          },
          { status: 401 },
        ),
      ),
    );
    const client = new ApiClient({
      baseUrl: BASE_URL,
      onAuthenticationRequired,
    });

    await expect(
      client.requestNoContent("/auth/login", {
        method: "POST",
        classification: "public",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(onAuthenticationRequired).not.toHaveBeenCalled();
  });
});

describe("parseRetryAfter", () => {
  it("accepts only bounded positive integer seconds", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("0")).toBeUndefined();
    expect(parseRetryAfter("1.5")).toBeUndefined();
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT")).toBeUndefined();
    expect(parseRetryAfter("86401")).toBeUndefined();
  });
});
