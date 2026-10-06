import "reflect-metadata";

import { Writable } from "node:stream";

import { NestFactory } from "@nestjs/core";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../../src/app.module.js";
import { configureCors } from "../../../src/config/cors.js";
import { loadServerConfig } from "../../../src/config/server-config.js";
import {
  FakeAuth0Tenant,
  FAKE_DATABASE_CONNECTION,
} from "../../../src/identity/infrastructure/fake-auth0-tenant.test-support.js";
import { generateUuidV7 } from "../../../src/infrastructure/identifiers/uuid-v7.js";
import {
  configureObservability,
  createObservability,
} from "../../../src/observability/observability.js";
import type { MembershipRole } from "../../../src/tenancy/application/authorization.js";

const WEB_APP_ORIGIN = "http://localhost:5173";

type Member = Readonly<{
  userId: string;
  email: string;
  subject: string;
  membershipId: string;
}>;

type SignedIn = Readonly<{ cookie: string; csrfToken: string }>;

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

describe("Membership administration HTTP with PostgreSQL", () => {
  const auth0 = new FakeAuth0Tenant();
  const destination = new Writable({
    write(_chunk: Buffer, _encoding, callback): void {
      callback();
    },
  });
  const fixtureSql = new Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
  });
  // audit_records FORCEs RLS even for its owner; only the bootstrap admin
  // (which bypasses RLS) can read it back for verification.
  const auditSql = new Client({
    connectionString: process.env.BCM_TEST_ADMIN_DATABASE_URL,
  });
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;

  async function createOrganization(): Promise<string> {
    const id = generateUuidV7();
    await fixtureSql.query(
      `INSERT INTO organizations (id, name, status, timezone, created_at, updated_at)
       VALUES ($1::uuid, 'Memberships HTTP', 'Active', 'America/Argentina/Buenos_Aires', now(), now())`,
      [id],
    );
    return id;
  }

  async function createMember(
    organizationId: string,
    role: MembershipRole,
  ): Promise<Member> {
    const userId = generateUuidV7();
    const email = `${role.toLowerCase()}-${userId}@members.test`;
    const subject = auth0.seedAccount(email);
    const membershipId = generateUuidV7();
    await fixtureSql.query(
      `INSERT INTO users (id, email, email_normalized, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $2, 'Active', now(), now())`,
      [userId, email],
    );
    await fixtureSql.query(
      `INSERT INTO user_external_identities (id, user_id, provider, subject, created_at)
       VALUES ($1::uuid, $2::uuid, 'auth0', $3, now())`,
      [generateUuidV7(), userId, subject],
    );
    await fixtureSql.query(
      `INSERT INTO organization_memberships
        (id, organization_id, user_id, role, status, activated_at, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'Active', now(), now(), now())`,
      [membershipId, organizationId, userId, role],
    );
    return { userId, email, subject, membershipId };
  }

  async function signIn(subject: string): Promise<SignedIn> {
    const start = await fetch(`${baseUrl}/api/auth/auth0/start`, {
      redirect: "manual",
    });
    const transaction = cookiePair(start.headers.getSetCookie()[0] ?? "");
    const callbackUrl = new URL(
      auth0.approve(start.headers.get("location") ?? "", subject),
    );
    const callback = await fetch(
      `${baseUrl}/api/auth/auth0/callback${callbackUrl.search}`,
      { redirect: "manual", headers: { cookie: transaction } },
    );
    const sessionCookie = callback.headers
      .getSetCookie()
      .find((value) => value.startsWith("bcm_session="));
    if (sessionCookie === undefined) throw new Error("Sign-in failed.");
    const cookie = cookiePair(sessionCookie);
    const session = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie },
    });
    const body = (await session.json()) as { csrfToken: string };
    return { cookie, csrfToken: body.csrfToken };
  }

  function provision(
    actor: SignedIn,
    body: unknown,
    headers: Readonly<{ origin?: string; csrf?: string | null }> = {},
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/organization/memberships`, {
      method: "POST",
      headers: {
        cookie: actor.cookie,
        origin: headers.origin ?? WEB_APP_ORIGIN,
        "content-type": "application/json",
        ...(headers.csrf === null
          ? {}
          : { "x-csrf-token": headers.csrf ?? actor.csrfToken }),
      },
      body: JSON.stringify(body),
    });
  }

  async function membershipCountFor(email: string): Promise<number> {
    const result = await fixtureSql.query(
      `SELECT 1 FROM organization_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE u.email_normalized = $1`,
      [email],
    );
    return result.rowCount ?? 0;
  }

  beforeAll(async () => {
    await auth0.start();
    await fixtureSql.connect();
    await auditSql.connect();
    const fake = auth0.config({
      callbackUrl: "http://localhost:3000/api/auth/auth0/callback",
      webAppOrigin: WEB_APP_ORIGIN,
    });
    const config = loadServerConfig({
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
    });
    const observability = createObservability(config, { destination });
    app = await NestFactory.create(
      AppModule.register(config, observability.logger),
      { logger: observability.logger },
    );
    app.setGlobalPrefix("api");
    configureCors(app, config);
    configureObservability(app, observability);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }, 30_000);

  beforeEach(() => {
    auth0.failNextManagementCall = false;
    auth0.failNextPasswordSetup = false;
  });

  afterAll(async () => {
    await app.close();
    await fixtureSql.end();
    await auditSql.end();
    await auth0.stop();
  });

  it("provisions a new User end to end: Auth0 account, link, Membership, audit, and email", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);
    const email = `new-${generateUuidV7()}@members.test`;

    const response = await provision(actor, {
      email: `  ${email.toUpperCase()} `,
      role: "Seller",
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, string>;
    expect(body).toMatchObject({
      email,
      role: "Seller",
      status: "Active",
      passwordSetupEmail: "sent",
    });
    expect(auth0.passwordSetupEmails).toContain(email);
    const subject = auth0.accounts.get(email)?.[0]?.subject;
    expect(subject).toMatch(/^auth0\|/u);

    const link = await fixtureSql.query(
      `SELECT u.id, u.status FROM users u
       JOIN user_external_identities l ON l.user_id = u.id
       WHERE u.email_normalized = $1 AND l.provider = 'auth0' AND l.subject = $2`,
      [email, subject],
    );
    expect(link.rows).toEqual([{ id: body.userId, status: "Active" }]);
    const membership = await fixtureSql.query(
      `SELECT organization_id, role, status, authorization_version
       FROM organization_memberships WHERE id = $1::uuid`,
      [body.id],
    );
    expect(membership.rows).toEqual([
      {
        organization_id: organizationId,
        role: "Seller",
        status: "Active",
        authorization_version: "1",
      },
    ]);
    const audit = await auditSql.query(
      `SELECT organization_id, actor_user_id, action, entity_type, after, correlation_id
       FROM audit_records WHERE entity_id = $1::uuid`,
      [body.id],
    );
    expect(audit.rows).toEqual([
      {
        organization_id: organizationId,
        actor_user_id: owner.userId,
        action: "membership.provisioned",
        entity_type: "OrganizationMembership",
        after: { userId: body.userId, role: "Seller", status: "Active" },
        correlation_id: response.headers.get("x-request-id"),
      },
    ]);

    // The new User signs in with the provisioned subject and gets Seller rights.
    const seller = await signIn(subject ?? "");
    const denied = await fetch(`${baseUrl}/api/organization/memberships`, {
      headers: { cookie: seller.cookie },
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("lists only the current Organization's Memberships with bounded pages", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const viewer = await createMember(organizationId, "Viewer");
    const outsider = await createMember(await createOrganization(), "Owner");
    const actor = await signIn(owner.subject);

    const first = await fetch(
      `${baseUrl}/api/organization/memberships?limit=1`,
      { headers: { cookie: actor.cookie } },
    );
    const firstPage = (await first.json()) as {
      items: Array<Record<string, string>>;
      nextCursor: string;
    };
    const second = await fetch(
      `${baseUrl}/api/organization/memberships?limit=1&after=${firstPage.nextCursor}`,
      { headers: { cookie: actor.cookie } },
    );
    const secondPage = (await second.json()) as {
      items: Array<Record<string, string>>;
      nextCursor: string | null;
    };

    expect(first.status).toBe(200);
    expect(firstPage.items).toEqual([
      expect.objectContaining({ id: owner.membershipId, email: owner.email }),
    ]);
    expect(secondPage).toEqual({
      items: [
        expect.objectContaining({
          id: viewer.membershipId,
          email: viewer.email,
          role: "Viewer",
        }),
      ],
      nextCursor: null,
    });
    expect(JSON.stringify([firstPage, secondPage])).not.toContain(
      outsider.email,
    );

    const invalid = await fetch(
      `${baseUrl}/api/organization/memberships?limit=101`,
      { headers: { cookie: actor.cookie } },
    );
    expect(invalid.status).toBe(400);
  });

  it("lets an Admin provision only Seller or Viewer, before calling Auth0", async () => {
    const organizationId = await createOrganization();
    const admin = await createMember(organizationId, "Admin");
    const actor = await signIn(admin.subject);

    for (const role of ["Admin", "Owner"]) {
      const email = `${role}-${generateUuidV7()}@members.test`;
      const response = await provision(actor, { email, role });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "ROLE_NOT_ALLOWED" });
      expect(auth0.accounts.has(email)).toBe(false);
    }
    const viewer = await provision(actor, {
      email: `viewer-${generateUuidV7()}@members.test`,
      role: "Viewer",
    });
    expect(viewer.status).toBe(201);
  });

  it("lets an Owner provision another Owner", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);

    const response = await provision(actor, {
      email: `owner-${generateUuidV7()}@members.test`,
      role: "Owner",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ role: "Owner" });
  });

  it("rejects an existing member without creating anything at Auth0", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const viewer = await createMember(organizationId, "Viewer");
    const actor = await signIn(owner.subject);
    const accountsBefore = auth0.accounts.get(viewer.email)?.length;

    const response = await provision(actor, {
      email: viewer.email,
      role: "Seller",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MEMBERSHIP_EXISTS" });
    expect(auth0.accounts.get(viewer.email)?.length).toBe(accountsBefore);
  });

  it("links an existing Auth0 database account without a password email", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);
    const email = `existing-${generateUuidV7()}@members.test`;
    const subject = auth0.seedAccount(email, FAKE_DATABASE_CONNECTION);

    const response = await provision(actor, { email, role: "Viewer" });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      passwordSetupEmail: "not-required",
    });
    expect(auth0.passwordSetupEmails).not.toContain(email);
    const link = await fixtureSql.query(
      `SELECT 1 FROM user_external_identities WHERE subject = $1`,
      [subject],
    );
    expect(link.rowCount).toBe(1);
  });

  it("creates a database account even when a social login shares the email", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);
    const email = `social-${generateUuidV7()}@members.test`;
    const socialSubject = auth0.seedAccount(email, "google-oauth2");

    const response = await provision(actor, { email, role: "Viewer" });

    expect(response.status).toBe(201);
    const links = await fixtureSql.query<{ subject: string }>(
      `SELECT l.subject FROM user_external_identities l
       JOIN users u ON u.id = l.user_id WHERE u.email_normalized = $1`,
      [email],
    );
    expect(links.rows).toHaveLength(1);
    expect(links.rows[0]?.subject).not.toBe(socialSubject);
    expect(links.rows[0]?.subject).toMatch(/^auth0\|/u);
  });

  it("rolls back and hides the reason when the User is linked to another subject", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);
    const elsewhere = await createMember(await createOrganization(), "Viewer");
    // The BCM User keeps a subject Auth0 no longer has for this email.
    auth0.accounts.delete(elsewhere.email);

    const response = await provision(actor, {
      email: elsewhere.email,
      role: "Viewer",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "PROVISIONING_CONFLICT",
    });
    expect(await membershipCountFor(elsewhere.email)).toBe(1);
    const audit = await auditSql.query(
      "SELECT 1 FROM audit_records WHERE organization_id = $1::uuid",
      [organizationId],
    );
    expect(audit.rowCount).toBe(0);
  });

  it("returns 503 and writes nothing when Auth0 is unavailable", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);
    const email = `down-${generateUuidV7()}@members.test`;
    auth0.failNextManagementCall = true;

    const response = await provision(actor, { email, role: "Viewer" });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "IDENTITY_PROVIDER_UNAVAILABLE",
    });
    const users = await fixtureSql.query(
      "SELECT 1 FROM users WHERE email_normalized = $1",
      [email],
    );
    expect(users.rowCount).toBe(0);
  });

  it("keeps the Membership when only the password email fails", async () => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);
    const email = `mail-${generateUuidV7()}@members.test`;
    auth0.failNextPasswordSetup = true;

    const response = await provision(actor, { email, role: "Viewer" });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      passwordSetupEmail: "failed",
    });
    expect(auth0.passwordSetupEmails).not.toContain(email);
    expect(await membershipCountFor(email)).toBe(1);
  });

  it.each([
    ["a missing CSRF token", { csrf: null }, "CSRF_VALIDATION_FAILED"],
    [
      "a wrong CSRF token",
      { csrf: `v1.${"A".repeat(43)}` },
      "CSRF_VALIDATION_FAILED",
    ],
    [
      "an untrusted origin",
      { origin: "https://evil.test" },
      "ORIGIN_VALIDATION_FAILED",
    ],
  ] as const)("rejects %s before any work", async (_name, headers, code) => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);
    const email = `csrf-${generateUuidV7()}@members.test`;

    const response = await provision(actor, { email, role: "Viewer" }, headers);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code });
    expect(auth0.accounts.has(email)).toBe(false);
  });

  it.each([
    [
      "an extra field",
      { email: "x@members.test", role: "Viewer", organizationId: "x" },
    ],
    ["a missing role", { email: "x@members.test" }],
    ["a non-string email", { email: 1, role: "Viewer" }],
  ])("rejects a body with %s", async (_name, body) => {
    const organizationId = await createOrganization();
    const owner = await createMember(organizationId, "Owner");
    const actor = await signIn(owner.subject);

    const response = await provision(actor, body);

    expect(response.status).toBe(400);
  });

  it("requires an authenticated Session", async () => {
    const response = await fetch(`${baseUrl}/api/organization/memberships`);

    expect(response.status).toBe(401);
  });
});
