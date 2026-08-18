import "reflect-metadata";

import { Writable } from "node:stream";

import { Controller, Get, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import type { ServerConfig } from "../config/server-config.js";
import {
  configureObservability,
  createObservability,
} from "./observability.js";
import { REQUEST_ID_HEADER } from "./request-id.js";
import { SafeHttpException } from "./safe-http-exception.js";

const VALID_REQUEST_ID = "d9428888-122b-4b8b-a38f-4fd56a544759";
const SECOND_REQUEST_ID = "7ebdb388-8d30-4a8f-9f74-944b83f58429";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("test")
class TestController {
  @Get("unexpected-error")
  unexpectedError(): never {
    throw new Error("database path C:\\private and token super-secret");
  }

  @Get("expected-error")
  expectedError(): never {
    throw new SafeHttpException(
      409,
      "SAFE_CONFLICT",
      "A safe conflict occurred.",
    );
  }
}

@Module({ imports: [AppModule], controllers: [TestController] })
class TestAppModule {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

describe("API observability foundation", () => {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  const config: ServerConfig = Object.freeze({
    database: Object.freeze({
      runtimeUrl:
        "postgresql://test-user:test-password@127.0.0.1:5432/bcm_soft_test",
    }),
    environment: "test",
    port: 0,
    session: Object.freeze({
      idleTimeoutMilliseconds: 1_800_000,
      absoluteLifetimeMilliseconds: 43_200_000,
      touchIntervalMilliseconds: 300_000,
    }),
    sessionCookie: Object.freeze({
      name: "bcm_session",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      path: "/",
    }),
    security: Object.freeze({
      trustedOrigins: Object.freeze(["https://app.bcm.test"]),
      csrfHmacKey: Buffer.alloc(32, 1),
      rateLimitHmacKey: Buffer.alloc(32, 2),
      loginRateLimits: Object.freeze({
        network: Object.freeze({
          maximumAttempts: 30,
          windowMilliseconds: 600_000,
          blockMilliseconds: 600_000,
        }),
        identity: Object.freeze({
          maximumAttempts: 10,
          windowMilliseconds: 900_000,
          blockMilliseconds: 900_000,
        }),
        identityNetwork: Object.freeze({
          maximumAttempts: 5,
          windowMilliseconds: 600_000,
          blockMilliseconds: 600_000,
        }),
      }),
    }),
  });
  const runtime = createObservability(config, {
    destination,
    level: "debug",
  });
  let app: INestApplication;
  let baseUrl: string;

  function capturedLogs(): Record<string, unknown>[] {
    return chunks
      .join("")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isRecord);
  }

  async function request(path: string, requestId?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      headers:
        requestId === undefined ? {} : { [REQUEST_ID_HEADER]: requestId },
    });
  }

  beforeAll(async () => {
    app = await NestFactory.create(TestAppModule, { logger: runtime.logger });
    app.setGlobalPrefix("api");
    configureObservability(app, runtime);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }, 30_000);

  beforeEach(() => {
    chunks.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it("generates a request ID when the incoming header is absent", async () => {
    const response = await request("/api/health/live");
    const requestId = response.headers.get(REQUEST_ID_HEADER);

    expect(requestId).toMatch(UUID_PATTERN);
  });

  it("propagates a valid incoming request ID", async () => {
    const response = await request("/api/health/live", VALID_REQUEST_ID);

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(VALID_REQUEST_ID);
  });

  it("replaces an invalid or oversized incoming request ID", async () => {
    const invalidRequestId = `not-a-uuid-${"x".repeat(256)}`;
    const response = await request("/api/health/live", invalidRequestId);
    const requestId = response.headers.get(REQUEST_ID_HEADER);

    expect(requestId).toMatch(UUID_PATTERN);
    expect(requestId).not.toBe(invalidRequestId);
  });

  it("places the request ID in the response header", async () => {
    const response = await request("/api/health/ready", SECOND_REQUEST_ID);

    expect(response.headers.has(REQUEST_ID_HEADER)).toBe(true);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(SECOND_REQUEST_ID);
  });

  it("returns a stable safe response for an unexpected error", async () => {
    const response = await request(
      "/api/test/unexpected-error",
      VALID_REQUEST_ID,
    );

    await expect(response.json()).resolves.toEqual({
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      requestId: VALID_REQUEST_ID,
    });
    expect(response.status).toBe(500);
  });

  it("does not expose exception messages, paths, stacks, or secrets", async () => {
    const response = await request("/api/test/unexpected-error");
    const body = await response.text();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(body).not.toContain("database");
    expect(body).not.toContain("C:\\private");
    expect(body).not.toContain("super-secret");
    expect(body).not.toContain("stack");
    expect(chunks.join("")).not.toContain("super-secret");
    expect(chunks.join("")).not.toContain("C:\\private");
  });

  it("preserves the stable contract of an explicitly safe expected error", async () => {
    const response = await request(
      "/api/test/expected-error",
      VALID_REQUEST_ID,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      statusCode: 409,
      code: "SAFE_CONFLICT",
      message: "A safe conflict occurred.",
      requestId: VALID_REQUEST_ID,
    });
  });

  it("correlates the completion log with the request ID", async () => {
    await request("/api/health/live", VALID_REQUEST_ID);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(capturedLogs()).toContainEqual(
      expect.objectContaining({
        event: "http.request.completed",
        requestId: VALID_REQUEST_ID,
        statusCode: 200,
      }),
    );
  });

  it("redacts nested sensitive fields and casing variants", () => {
    runtime.logger.record("info", "redaction.test", {
      authorization: "Bearer credential",
      cookie: "session-cookie",
      token: "generic-token",
      "set-cookie": "response-cookie",
      nested: {
        PASSWORD: "password-value",
        passwordHash: "password-hash-value",
        password_hash: "snake-password-hash-value",
        currentPassword: "current-password-value",
        newPassword: "new-password-value",
        candidatePassword: "candidate-password-value",
        access_token: "access-value",
        RefreshToken: "refresh-value",
        sessionToken: "raw-session-value",
        session_token: "snake-session-value",
        tokenHash: "token-hash-value",
        token_hash: "snake-token-hash-value",
        sessionTokenHash: "session-token-hash-value",
        apiKey: "api-key-value",
        session: "session-value",
        harmless: "visible",
      },
    });

    const output = chunks.join("");

    expect(output).not.toContain("credential");
    expect(output).not.toContain("session-cookie");
    expect(output).not.toContain("generic-token");
    expect(output).not.toContain("response-cookie");
    expect(output).not.toContain("password-value");
    expect(output).not.toContain("password-hash-value");
    expect(output).not.toContain("snake-password-hash-value");
    expect(output).not.toContain("current-password-value");
    expect(output).not.toContain("new-password-value");
    expect(output).not.toContain("candidate-password-value");
    expect(output).not.toContain("access-value");
    expect(output).not.toContain("refresh-value");
    expect(output).not.toContain("raw-session-value");
    expect(output).not.toContain("snake-session-value");
    expect(output).not.toContain("token-hash-value");
    expect(output).not.toContain("snake-token-hash-value");
    expect(output).not.toContain("session-token-hash-value");
    expect(output).not.toContain("api-key-value");
    expect(output).not.toContain("session-value");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("visible");
  });

  it("redacts PHC values and sanitizes errors before logging", () => {
    const passwordHash = "$argon2id$v=19$m=19456,t=2,p=1$c2Vuc2l0aXZl$ZGlnZXN0";
    const sensitiveError = new Error(
      `addon failed for plaintext-secret and ${passwordHash}`,
    );

    runtime.logger.record("error", "redaction.password", {
      diagnostic: passwordHash,
      error: sensitiveError,
    });

    const output = chunks.join("");

    expect(output).not.toContain(passwordHash);
    expect(output).not.toContain("plaintext-secret");
    expect(output).not.toContain("addon failed");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain('"name":"Error"');
  });

  it("reports liveness without leaking configuration", async () => {
    const response = await request("/api/health/live");
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(JSON.stringify(body)).not.toContain("environment");
    expect(JSON.stringify(body)).not.toContain("port");
  });

  it("reports readiness without claiming unavailable dependency checks", async () => {
    const response = await request("/api/health/ready");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("isolates request IDs across concurrent requests", async () => {
    const [firstResponse, secondResponse] = await Promise.all([
      request("/api/health/live", VALID_REQUEST_ID),
      request("/api/health/ready", SECOND_REQUEST_ID),
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(firstResponse.headers.get(REQUEST_ID_HEADER)).toBe(VALID_REQUEST_ID);
    expect(secondResponse.headers.get(REQUEST_ID_HEADER)).toBe(
      SECOND_REQUEST_ID,
    );

    const completionRequestIds = capturedLogs()
      .filter((entry) => entry.event === "http.request.completed")
      .map((entry) => entry.requestId);

    expect(completionRequestIds).toContain(VALID_REQUEST_ID);
    expect(completionRequestIds).toContain(SECOND_REQUEST_ID);
  });
});
