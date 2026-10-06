import type { Clock } from "../../identity/application/clock.js";
import { normalizeIdentityEmail } from "../../identity/application/email-address.js";
import {
  type ExternalAccount,
  ExternalAccountConflictError,
  type ExternalAccountDirectory,
  ExternalAccountDirectoryError,
  type UserProvisioningRepository,
} from "../../identity/application/user-provisioning.js";
import {
  AuthorizationPolicy,
  type AuthorizationContext,
  definePermissionRequirement,
  isMembershipRole,
  type MembershipRole,
  RoleTargetEligibilityPolicy,
} from "./authorization.js";
import type { TenantContext } from "./tenant-authority.js";
import {
  type AuthorizedTenantOperation,
  type AuthorizedTenantPersistenceResult,
  TenantPersistenceError,
  type TenantPersistenceScope,
} from "./tenant-persistence-scope.js";

/** Supplies new UUIDv7 identifiers; injected by composition. */
type IdentifierGenerator = () => string;

export type MembershipStatus = "Active" | "Suspended" | "Revoked";

export type MembershipRecord = Readonly<{
  id: string;
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
}>;

/** Tenant-bound: every method is scoped to the transaction's Organization. */
export interface OrganizationMembershipRepository {
  existsForUser(userId: string): Promise<boolean>;
  create(
    input: Readonly<{
      id: string;
      userId: string;
      role: MembershipRole;
      now: Date;
    }>,
  ): Promise<void>;
  /** Ordered by id (UUIDv7, creation order); `afterId` is exclusive. */
  list(
    input: Readonly<{ limit: number; afterId: string | null }>,
  ): Promise<readonly MembershipRecord[]>;
}

export type AuditRecordInput = Readonly<{
  id: string;
  /** Null for system events, such as the one-time initial setup. */
  actorUserId: string | null;
  action: "membership.provisioned" | "organization.initialized";
  entityType: "OrganizationMembership" | "Organization";
  entityId: string;
  after: Readonly<Record<string, string>>;
  correlationId: string | null;
  occurredAt: Date;
}>;

/** Tenant-bound, append-only. */
export interface AuditRecordWriter {
  append(record: AuditRecordInput): Promise<void>;
}

export type MembershipAdministrationRepositories = Readonly<{
  memberships: OrganizationMembershipRepository;
  users: UserProvisioningRepository;
  audit: AuditRecordWriter;
}>;

const MEMBERSHIPS_READ = definePermissionRequirement("memberships.read");
const MEMBERSHIPS_MANAGE = definePermissionRequirement("memberships.manage");
export const MEMBERSHIP_LIST_MAX_LIMIT = 100;

type AuthorizationDenial = Exclude<
  AuthorizedTenantPersistenceResult<never>,
  { status: "executed" }
>;

export type MembershipListResult =
  | Readonly<{
      status: "listed";
      items: ReadonlyArray<MembershipRecord & Readonly<{ email: string }>>;
      nextCursor: string | null;
    }>
  | AuthorizationDenial;

export type ProvisionMembershipResult =
  | Readonly<{
      status: "provisioned";
      membershipId: string;
      userId: string;
      email: string;
      role: MembershipRole;
      createdAt: Date;
      passwordSetupEmail: "sent" | "failed" | "not-required";
    }>
  | Readonly<{ status: "invalid-email" }>
  | Readonly<{ status: "role-not-allowed" }>
  | Readonly<{ status: "already-member" }>
  | Readonly<{ status: "identity-conflict" }>
  | Readonly<{ status: "user-disabled" }>
  | Readonly<{ status: "provider-unavailable" }>
  | AuthorizationDenial;

type Rejection = Extract<
  ProvisionMembershipResult,
  {
    status:
      | "role-not-allowed"
      | "already-member"
      | "identity-conflict"
      | "user-disabled";
  }
>;

/** Thrown inside the transaction callback so nothing partial commits. */
class ProvisioningRejected extends Error {
  constructor(readonly result: Rejection) {
    super("Membership provisioning was rejected.");
    this.name = "ProvisioningRejected";
  }
}

function reject(status: Rejection["status"]): never {
  throw new ProvisioningRejected(Object.freeze({ status }));
}

export interface ProvisioningAuditLog {
  recordPasswordSetupEmailFailed(): void;
}

export class MembershipAdministration {
  private readonly policy = new AuthorizationPolicy();
  private readonly roles = new RoleTargetEligibilityPolicy();

  constructor(
    private readonly scope: TenantPersistenceScope<MembershipAdministrationRepositories>,
    private readonly accounts: ExternalAccountDirectory,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
    private readonly log: ProvisioningAuditLog,
  ) {}

  async list(
    tenant: TenantContext,
    input: Readonly<{ limit: number; afterId: string | null }>,
  ): Promise<MembershipListResult> {
    const result = await this.scope.runAuthorized(
      tenant,
      MEMBERSHIPS_READ,
      async ({ repositories }) => {
        const page = await repositories.memberships.list({
          limit: input.limit + 1,
          afterId: input.afterId,
        });
        const items = page.slice(0, input.limit);
        const emails = await repositories.users.findEmailsByUserIds(
          items.map((item) => item.userId),
        );
        return Object.freeze({
          status: "listed" as const,
          items: items.map((item) =>
            Object.freeze({ ...item, email: emails.get(item.userId) ?? "" }),
          ),
          nextCursor:
            page.length > input.limit ? (items.at(-1)?.id ?? null) : null,
        });
      },
    );
    return result.status === "executed" ? result.value : result;
  }

  /**
   * Phase 1 authorizes and checks preconditions; the provider call runs with
   * no transaction open; phase 2 re-authorizes and writes User link,
   * Membership, and Audit Record atomically. The password-setup email is sent
   * only after commit and only for a provider account created by this call.
   */
  async provision(
    tenant: TenantContext,
    input: Readonly<{
      email: unknown;
      role: unknown;
      correlationId: string | null;
    }>,
  ): Promise<ProvisionMembershipResult> {
    let normalizedEmail: string;
    try {
      normalizedEmail = normalizeIdentityEmail(input.email);
    } catch {
      return Object.freeze({ status: "invalid-email" });
    }
    if (!isMembershipRole(input.role)) {
      return Object.freeze({ status: "role-not-allowed" });
    }
    const role = input.role;

    const precheck = await this.inTransaction(tenant, async (operation) => {
      this.assertRoleAllowed(operation.authorization, role);
      await this.assertNotMember(operation.repositories, normalizedEmail);
      return null;
    });
    if (precheck.status !== "executed") return precheck.result;

    let account: ExternalAccount;
    try {
      account = await this.accounts.ensureAccount(normalizedEmail);
    } catch (error: unknown) {
      if (error instanceof ExternalAccountConflictError) {
        return Object.freeze({ status: "identity-conflict" });
      }
      if (error instanceof ExternalAccountDirectoryError) {
        return Object.freeze({ status: "provider-unavailable" });
      }
      throw error;
    }

    const written = await this.inTransaction(tenant, async (operation) => {
      const { authorization, repositories } = operation;
      this.assertRoleAllowed(authorization, role);
      await this.assertNotMember(repositories, normalizedEmail);
      const now = this.clock.now();
      const link = await repositories.users.ensureUserLinkedTo({
        email: normalizedEmail,
        normalizedEmail,
        account,
        newUserId: this.identifiers(),
        newLinkId: this.identifiers(),
        now,
      });
      if (link.status !== "linked") reject(link.status);

      const membershipId = this.identifiers();
      await repositories.memberships.create({
        id: membershipId,
        userId: link.userId,
        role,
        now,
      });
      await repositories.audit.append({
        id: this.identifiers(),
        actorUserId: authorization.tenant.userId,
        action: "membership.provisioned",
        entityType: "OrganizationMembership",
        entityId: membershipId,
        after: { userId: link.userId, role, status: "Active" },
        correlationId: input.correlationId,
        occurredAt: now,
      });
      return { membershipId, userId: link.userId, createdAt: now };
    });
    if (written.status !== "executed") return written.result;

    let passwordSetupEmail: "sent" | "failed" | "not-required" = "not-required";
    if (account.created) {
      try {
        await this.accounts.sendPasswordSetup(normalizedEmail);
        passwordSetupEmail = "sent";
      } catch (error: unknown) {
        if (!(error instanceof ExternalAccountDirectoryError)) throw error;
        // The Membership stands; the User can use "forgot password" at Auth0.
        this.log.recordPasswordSetupEmailFailed();
        passwordSetupEmail = "failed";
      }
    }

    return Object.freeze({
      status: "provisioned",
      membershipId: written.value.membershipId,
      userId: written.value.userId,
      email: normalizedEmail,
      role,
      createdAt: written.value.createdAt,
      passwordSetupEmail,
    });
  }

  /** Owner creation needs `memberships.manage_owner` besides eligibility. */
  private assertRoleAllowed(
    authorization: AuthorizationContext,
    role: MembershipRole,
  ): void {
    const eligible =
      this.roles.evaluateMembershipManagement(authorization.role, role)
        .status === "eligible";
    const ownerAllowed =
      role !== "Owner" ||
      this.policy.can(authorization, "memberships.manage_owner");
    if (!eligible || !ownerAllowed) reject("role-not-allowed");
  }

  private async assertNotMember(
    repositories: MembershipAdministrationRepositories,
    normalizedEmail: string,
  ): Promise<void> {
    const userId = await repositories.users.findUserIdByEmail(normalizedEmail);
    if (
      userId !== null &&
      (await repositories.memberships.existsForUser(userId))
    ) {
      reject("already-member");
    }
  }

  private async inTransaction<Value>(
    tenant: TenantContext,
    operation: (
      scope: AuthorizedTenantOperation<MembershipAdministrationRepositories>,
    ) => Promise<Value>,
  ): Promise<
    | Readonly<{ status: "executed"; value: Value }>
    | Readonly<{ status: "rejected"; result: ProvisionMembershipResult }>
  > {
    try {
      const result = await this.scope.runAuthorized(
        tenant,
        MEMBERSHIPS_MANAGE,
        operation,
      );
      return result.status === "executed"
        ? result
        : Object.freeze({ status: "rejected", result });
    } catch (error: unknown) {
      if (
        error instanceof TenantPersistenceError &&
        error.cause instanceof ProvisioningRejected
      ) {
        return Object.freeze({
          status: "rejected",
          result: error.cause.result,
        });
      }
      throw error;
    }
  }
}
