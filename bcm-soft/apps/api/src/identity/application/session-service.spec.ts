import { describe, expect, it } from "vitest";

import type { Clock } from "./clock.js";
import {
  type NewSessionRecord,
  type SessionRepository,
  SessionPersistenceError,
  SessionTokenHashCollisionError,
  type SessionValidationRecord,
} from "./session-repository.js";
import { SessionCreationError, SessionService } from "./session-service.js";
import type { SessionTokenService } from "./session-token-service.js";

const START = new Date("2026-08-17T12:00:00.000Z");
const POLICY = {
  idleTimeoutMilliseconds: 30 * 60_000,
  absoluteLifetimeMilliseconds: 12 * 60 * 60_000,
  touchIntervalMilliseconds: 5 * 60_000,
};

class MutableClock implements Clock {
  constructor(public value = START) {}
  now(): Date {
    return this.value;
  }
}

class FakeTokenService implements SessionTokenService {
  generated = 0;
  generate(): string {
    this.generated += 1;
    return `${String(this.generated).padStart(2, "0")}${"a".repeat(41)}`;
  }
  digest(rawToken: string): Buffer {
    return Buffer.from(rawToken.padEnd(32, "x").slice(0, 32));
  }
  isValidFormat(rawToken: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/u.test(rawToken);
  }
}

class InMemorySessionRepository implements SessionRepository {
  activeUser = true;
  collisionsRemaining = 0;
  findCalls = 0;
  touches = 0;
  records = new Map<string, SessionValidationRecord>();

  async createForActiveUser(
    record: NewSessionRecord,
  ): Promise<"created" | "user-inactive"> {
    if (!this.activeUser) return "user-inactive";
    if (this.collisionsRemaining > 0) {
      this.collisionsRemaining -= 1;
      throw new SessionTokenHashCollisionError();
    }
    this.records.set(record.tokenHash.toString("hex"), {
      id: record.id,
      userId: record.userId,
      userStatus: "Active",
      expiresAt: record.expiresAt,
      revokedAt: null,
      lastSeenAt: record.lastSeenAt,
      createdAt: record.createdAt,
      selectedOrganizationId: null,
      selectedMembershipAuthorizationVersion: null,
    });
    return "created";
  }

  async findForValidationByTokenHash(
    tokenHash: Buffer,
  ): Promise<SessionValidationRecord | null> {
    this.findCalls += 1;
    return this.records.get(tokenHash.toString("hex")) ?? null;
  }

  async revokeByTokenHash(tokenHash: Buffer, revokedAt: Date): Promise<void> {
    const key = tokenHash.toString("hex");
    const record = this.records.get(key);
    if (record !== undefined && record.revokedAt === null) {
      this.records.set(key, { ...record, revokedAt });
    }
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<void> {
    for (const [key, record] of this.records) {
      if (record.userId === userId && record.revokedAt === null) {
        this.records.set(key, { ...record, revokedAt });
      }
    }
  }

  async touchLastSeenIfDue(
    input: Readonly<{ sessionId: string; now: Date }>,
  ): Promise<boolean> {
    this.touches += 1;
    for (const [key, record] of this.records) {
      if (record.id === input.sessionId) {
        this.records.set(key, { ...record, lastSeenAt: input.now });
        return true;
      }
    }
    return false;
  }
}

function createFixture() {
  const repository = new InMemorySessionRepository();
  const tokens = new FakeTokenService();
  const clock = new MutableClock();
  let identifier = 0;
  const service = new SessionService(
    repository,
    tokens,
    clock,
    () => `0198d5a0-1000-7000-8000-${String(++identifier).padStart(12, "0")}`,
    POLICY,
  );
  return { clock, repository, service, tokens };
}

describe("SessionService", () => {
  it("creates a session for an authoritative Active User without returning the digest", async () => {
    const { repository, service } = createFixture();
    const created = await service.createSession(
      "0198d5a0-0000-7000-8000-000000000001",
    );

    expect(created.rawToken).toHaveLength(43);
    expect(created.sessionId).toMatch(/000000000001$/u);
    expect(created.expiresAt).toEqual(
      new Date(START.getTime() + 12 * 60 * 60_000),
    );
    expect(created).not.toHaveProperty("tokenHash");
    expect([...repository.records.values()][0]).toMatchObject({
      createdAt: START,
      lastSeenAt: START,
      revokedAt: null,
      selectedOrganizationId: null,
      selectedMembershipAuthorizationVersion: null,
    });
  });

  it("rejects creation for an inactive User with a safe error", async () => {
    const { repository, service } = createFixture();
    repository.activeUser = false;

    await expect(service.createSession("disabled-user")).rejects.toEqual(
      new SessionCreationError(),
    );
  });

  it("retries only token-hash collisions and stops after three total attempts", async () => {
    const fixture = createFixture();
    fixture.repository.collisionsRemaining = 2;
    await expect(
      fixture.service.createSession("active-user"),
    ).resolves.toBeDefined();
    expect(fixture.tokens.generated).toBe(3);

    const exhausted = createFixture();
    exhausted.repository.collisionsRemaining = 3;
    await expect(
      exhausted.service.createSession("active-user"),
    ).rejects.toBeInstanceOf(SessionCreationError);
    expect(exhausted.tokens.generated).toBe(3);
  });

  it("does not retry unrelated persistence errors", async () => {
    const { repository, service, tokens } = createFixture();
    repository.createForActiveUser = async () => {
      throw new SessionPersistenceError();
    };

    await expect(service.createSession("active-user")).rejects.toBeInstanceOf(
      SessionPersistenceError,
    );
    expect(tokens.generated).toBe(1);
  });

  it("fails malformed and unknown tokens with the same generic result and no malformed lookup", async () => {
    const { repository, service } = createFixture();

    await expect(service.validateSession("malformed")).resolves.toEqual({
      status: "invalid",
    });
    expect(repository.findCalls).toBe(0);
    await expect(service.validateSession("z".repeat(43))).resolves.toEqual({
      status: "invalid",
    });
    expect(repository.findCalls).toBe(1);
  });

  it("validates active state, preserves the Organization selection distinction, and throttles touch", async () => {
    const { clock, repository, service } = createFixture();
    const created = await service.createSession("active-user");

    await expect(
      service.validateSession(created.rawToken),
    ).resolves.toMatchObject({
      status: "valid",
      selectedOrganizationId: null,
      selectedMembershipAuthorizationVersion: null,
    });
    expect(repository.touches).toBe(0);

    clock.value = new Date(START.getTime() + 5 * 60_000);
    await expect(
      service.validateSession(created.rawToken),
    ).resolves.toMatchObject({ status: "valid" });
    expect(repository.touches).toBe(1);
  });

  it("rejects revoked, expired, and Disabled sessions without disclosing why", async () => {
    const cases: Array<
      (record: SessionValidationRecord) => SessionValidationRecord
    > = [
      (record) => ({ ...record, revokedAt: START }),
      (record) => ({ ...record, expiresAt: START }),
      (record) => ({
        ...record,
        lastSeenAt: new Date(START.getTime() - 30 * 60_000),
      }),
      (record) => ({ ...record, userStatus: "Disabled" }),
    ];

    for (const alter of cases) {
      const { repository, service } = createFixture();
      const created = await service.createSession("active-user");
      const key = [...repository.records.keys()][0];
      if (key === undefined) throw new Error("fixture failed");
      const record = repository.records.get(key);
      if (record === undefined) throw new Error("fixture failed");
      repository.records.set(key, alter(record));

      await expect(service.validateSession(created.rawToken)).resolves.toEqual({
        status: "invalid",
      });
    }
  });

  it("revokes one or all sessions idempotently without revealing unknown tokens", async () => {
    const { clock, repository, service } = createFixture();
    const first = await service.createSession("active-user");
    const second = await service.createSession("active-user");
    clock.value = new Date(START.getTime() + 1_000);

    await service.revokeSession(first.rawToken);
    await service.revokeSession(first.rawToken);
    await service.revokeSession("x".repeat(43));
    const firstRecord = [...repository.records.values()].find(
      (record) => record.id === first.sessionId,
    );
    expect(firstRecord?.revokedAt).toEqual(clock.value);

    clock.value = new Date(START.getTime() + 2_000);
    await service.revokeAllSessionsForUser("active-user");
    await service.revokeAllSessionsForUser("active-user");
    const secondRecord = [...repository.records.values()].find(
      (record) => record.id === second.sessionId,
    );
    expect(secondRecord?.revokedAt).toEqual(clock.value);
  });
});
