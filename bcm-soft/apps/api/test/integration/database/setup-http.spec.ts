import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";

import { NestFactory } from "@nestjs/core";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../../src/app.module.js";
import { configureCors } from "../../../src/config/cors.js";
import {
  loadServerConfig,
  type ServerConfig,
} from "../../../src/config/server-config.js";
import { FakeAuth0Tenant } from "../../../src/identity/infrastructure/fake-auth0-tenant.test-support.js";
import {
  configureObservability,
  createObservability,
} from "../../../src/observability/observability.js";

const WEB_APP_ORIGIN = "http://localhost:5173";
const SETUP_TOKEN = randomBytes(32).toString("base64url");

type App = Awaited<ReturnType<typeof NestFactory.create>>;

describe("initial setup HTTP with PostgreSQL", () => {
  const auth0 = new FakeAuth0Tenant();
  // Bypasses RLS to reset the shared test database and read Audit Records.
  const adminSql = new Client({
    connectionString: process.env.BCM_TEST_ADMIN_DATABASE_URL,
  });
  const apps: App[] = [];
  let baseUrl: string;

  async function startApp(setupToken: string | null): Promise<string> {
    const fake = auth0.config({
      callbackUrl: "http://localhost:3000/api/auth/auth0/callback",
      webAppOrigin: WEB_APP_ORIGIN,
    });
    const config: ServerConfig = loadServerConfig({
      ...process.env,
      NODE_ENV: "test",
      TRUSTED_ORIGINS: WEB_APP_ORIGIN,
      WEB_APP_ORIGIN,
      AUTH0_ISSUER_URL: fake.issuerUrl,
      AUTH0_CLIENT_ID: fake.clientId,
      AUTH0_CLIENT_SECRET: fake.clientSecret,
      AUTH0_CALLBACK_URL: fake.callbackUrl,
      AUTH0_MANAGEMENT_CLIENT_ID: fake.management.clientId,
      AUTH0_MANAGEMENT_CLIENT_SECRET: fake.management.clientSecret,
      SETUP_TOKEN: setupToken ?? "",
    });
    const observability = createObservability(config, {
      destination: new Writable({
        write(_chunk, _encoding, callback): void {
          callback();
        },
      }),
    });
    const app = await NestFactory.create(
      AppModule.register(config, observability.logger),
      { logger: observability.logger },
    );
    app.setGlobalPrefix("api");
    configureCors(app, config);
    configureObservability(app, observability);
    await app.listen(0, "127.0.0.1");
    apps.push(app);
    return app.getUrl();
  }

  function submit(
    body: unknown,
    input: Readonly<{ origin?: string; url?: string }> = {},
  ): Promise<Response> {
    return fetch(`${input.url ?? baseUrl}/api/setup`, {
      method: "POST",
      headers: {
        origin: input.origin ?? WEB_APP_ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async function required(): Promise<boolean> {
    const response = await fetch(`${baseUrl}/api/setup`);
    return ((await response.json()) as { required: boolean }).required;
  }

  async function organizationCount(): Promise<number> {
    const result = await adminSql.query("SELECT 1 FROM organizations");
    return result.rowCount ?? 0;
  }

  beforeAll(async () => {
    await auth0.start();
    await adminSql.connect();
    baseUrl = await startApp(SETUP_TOKEN);
  }, 30_000);

  beforeEach(async () => {
    // Every case starts from an instance that was never configured.
    await adminSql.query(
      "TRUNCATE organizations, users RESTART IDENTITY CASCADE",
    );
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    await adminSql.end();
    await auth0.stop();
  });

  it("creates the Organization and its Owner exactly once", async () => {
    expect(await required()).toBe(true);
    const email = "owner@setup.test";

    const response = await submit({
      setupToken: SETUP_TOKEN,
      organizationName: "  BCM  ",
      ownerEmail: " OWNER@setup.test ",
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, string>;
    expect(body).toMatchObject({
      ownerEmail: email,
      passwordSetupEmail: "sent",
    });
    expect(auth0.passwordSetupEmails).toContain(email);
    expect(await required()).toBe(false);

    const owner = await adminSql.query(
      `SELECT o.name, m.role, m.status, l.subject
       FROM organizations o
       JOIN organization_memberships m ON m.organization_id = o.id
       JOIN users u ON u.id = m.user_id
       JOIN user_external_identities l ON l.user_id = u.id
       WHERE u.email_normalized = $1`,
      [email],
    );
    expect(owner.rows).toEqual([
      {
        name: "BCM",
        role: "Owner",
        status: "Active",
        subject: auth0.accounts.get(email)?.[0]?.subject,
      },
    ]);
    const audit = await adminSql.query(
      `SELECT action, entity_type, actor_user_id, correlation_id
       FROM audit_records WHERE organization_id = $1::uuid`,
      [body.organizationId],
    );
    expect(audit.rows).toEqual([
      {
        action: "organization.initialized",
        entity_type: "Organization",
        actor_user_id: null,
        correlation_id: response.headers.get("x-request-id"),
      },
    ]);

    const again = await submit({
      setupToken: SETUP_TOKEN,
      organizationName: "Other",
      ownerEmail: "other@setup.test",
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      code: "SETUP_ALREADY_COMPLETED",
    });
    expect(auth0.accounts.has("other@setup.test")).toBe(false);
    expect(await organizationCount()).toBe(1);
  });

  it("lets only one of two concurrent setups win", async () => {
    const responses = await Promise.all(
      ["first", "second"].map((name) =>
        submit({
          setupToken: SETUP_TOKEN,
          organizationName: name,
          ownerEmail: `${name}@setup.test`,
        }),
      ),
    );

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(await organizationCount()).toBe(1);
  });

  it.each([
    [
      "a wrong setup token",
      { setupToken: "x".repeat(43) },
      {},
      403,
      "SETUP_TOKEN_INVALID",
    ],
    [
      "an untrusted origin",
      {},
      { origin: "https://evil.test" },
      403,
      "ORIGIN_VALIDATION_FAILED",
    ],
    [
      "an invalid email",
      { ownerEmail: "not-an-email" },
      {},
      400,
      "INVALID_EMAIL",
    ],
    [
      "a blank organization name",
      { organizationName: "   " },
      {},
      400,
      "INVALID_ORGANIZATION_NAME",
    ],
    ["an extra field", { role: "Owner" }, {}, 400, "INVALID_REQUEST"],
  ] as const)(
    "rejects %s without creating anything",
    async (_name, overrides, headers, status, code) => {
      const response = await submit(
        {
          setupToken: SETUP_TOKEN,
          organizationName: "BCM",
          ownerEmail: "rejected@setup.test",
          ...overrides,
        },
        headers,
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
      expect(await organizationCount()).toBe(0);
      expect(auth0.accounts.has("rejected@setup.test")).toBe(false);
    },
  );

  it("returns 503 and writes nothing when Auth0 is unavailable", async () => {
    auth0.failNextManagementCall = true;

    const response = await submit({
      setupToken: SETUP_TOKEN,
      organizationName: "BCM",
      ownerEmail: "down@setup.test",
    });

    expect(response.status).toBe(503);
    expect(await organizationCount()).toBe(0);
  });

  it("stays disabled when the server has no setup token", async () => {
    const url = await startApp(null);

    const response = await submit(
      {
        setupToken: SETUP_TOKEN,
        organizationName: "BCM",
        ownerEmail: "disabled@setup.test",
      },
      { url },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "SETUP_UNAVAILABLE" });
    expect(await organizationCount()).toBe(0);
  });
});
