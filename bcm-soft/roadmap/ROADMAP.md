# BCM SOFT — Technical Implementation Roadmap

## 1. Current status

### Design and engineering planning

- [x] BCM-000 — Repository Foundation
- [x] BCM-001 — Product Definition
- [x] BCM-002 — Domain Definition
- [x] BCM-002A — Critical Domain Decisions
- [x] BCM-002B — Returns Scope Decision
- [x] BCM-003 — Architecture Definition
- [x] BCM-004 — Database Design
- [x] BCM-004A — Git Repository Foundation
- [x] BCM-005 — Security Architecture
- [x] BCM-005A — Security Database Addendum
- [x] BCM-006 — Backend Standards
- [x] BCM-007 — Frontend Standards
- [x] BCM-008 — Testing Strategy
- [x] BCM-009 — Observability Strategy
- [x] BCM-010 — Deployment Strategy
- [x] BCM-011 — Final Engineering Rules / AGENTS
- [x] BCM-012 — Technical Implementation Roadmap
- [x] BCM-012A — Customer Business Decisions Reconciliation

**Planning result:** `Design & Engineering Planning Phase Complete`.

`BCM-FND-001`, `BCM-FND-002`, `BCM-API-001`, `BCM-WEB-001`, and `BCM-TST-001` are Completed. `BCM-012A` is a completed documentation/decision task, not an implementation task. Every other implementation task below is `Pending` unless explicitly stated otherwise.

## 2. Authority and use

This roadmap derives sequencing from `AGENTS.md`, PRODUCT, DOMAIN, ARCHITECTURE, DATABASE, SECURITY, all specialist standards, Accepted ADRs, and the completed design roadmap.
It schedules work but does not override those sources.
When this roadmap conflicts with a higher-authority source, stop and apply the conflict procedure in `AGENTS.md`.
Codex receives one task at a time and never advances automatically to the next task, milestone, gate, or phase.
Future planning uses progressive elaboration: detailed near-term tasks, medium-detail next milestones, and coarse future phases.

## 3. Implementation principles

- Deliver vertical slices instead of giant horizontal layers.
- Keep each task coherent, independently reviewable, testable, and auditable in Git.
- Use the smallest implementation that proves the current contract.
- Build frontend against a real or already-approved contract, not imagined endpoints.
- Introduce database changes explicitly, never hidden inside unrelated UI work.
- Add security, tests, and observability proportionally within every slice.
- Establish request IDs, structured errors, logging, and CI early; mature provider integrations later.
- Verify tenant isolation before any commercial module.
- Verify inventory and concurrency before Sales.
- Verify Sale confirmation before cancellation, Reservations, and Trade-In.
- Stop at every Review Gate and await explicit approval.
- Do not create empty modules, universal shared packages, speculative abstractions, or permanent mocks.

Preferred slice:

```text
Domain / Contract
        ↓
Database, when required
        ↓
Backend use case and authorization
        ↓
REST API
        ↓
Frontend, when required
        ↓
Tests and observability
        ↓
Review Gate, when required
```

Not every slice needs every layer. Apply proportionality without omitting a boundary that protects an invariant.

## 4. Roadmap hierarchy

### Phase

A large group of related capabilities with a clear sequencing purpose.

### Milestone

A demonstrable technical or product outcome inside a phase.

### Task

The smallest coherent unit assigned to Codex. It has one objective, bounded scope, acceptance criteria, identifiable tests, and a reviewable diff.

### Review Gate

A mandatory stop after a risk-bearing milestone. Passing a gate requires evidence and explicit approval; it never triggers the next phase automatically.

Do not split work into ceremonial subtasks that cannot be reviewed meaningfully.
Do not use tasks such as “implement the entire inventory module.”

## 5. Task identifiers

| Prefix | Area |
|---|---|
| `BCM-FND` | Repository, tooling, and configuration foundations |
| `BCM-WEB` | Web application foundation and cross-feature frontend |
| `BCM-API` | API application foundation and cross-module backend |
| `BCM-DB` | PostgreSQL, Prisma, schema, migrations, and data safety |
| `BCM-SEC` | Identity and security controls |
| `BCM-TEN` | Organizations, Memberships, RBAC, tenant context, and RLS |
| `BCM-DS` | Design System |
| `BCM-CAT` | Business catalogs |
| `BCM-INV` | Equipment and Accessory inventory |
| `BCM-CUS` | Customers |
| `BCM-SUP` | Suppliers |
| `BCM-SAL` | Sales, payments, confirmation, and cancellation |
| `BCM-EXP` | Expenses and internal business result |
| `BCM-WAR` | Customer and Supplier Warranty |
| `BCM-FIN` | Financing bounded to approved V1 depth |
| `BCM-DASH` | Dashboard and business metrics |
| `BCM-RES` | Reservations |
| `BCM-TRD` | Trade-In |
| `BCM-PRC` | Price list and commercial configuration |
| `BCM-AUD` | Audit query experience |
| `BCM-TST` | Cross-cutting test infrastructure and quality validation |
| `BCM-OBS` | Observability |
| `BCM-CI` | CI/CD automation |
| `BCM-OPS` | Staging, production, recovery, and operations |
| `BCM-DEC` | Explicit decision gate; never implementation |
| `RG` | Review Gate |

IDs are stable and never reused. A superseded task retains its ID and status with a reference to its replacement.

## 6. Task status

- `Pending`: specified but not started.
- `In Progress`: the one currently authorized task.
- `Blocked`: cannot continue until a named dependency or decision is resolved.
- `Review`: implementation finished and awaiting its gate or acceptance.
- `Completed`: acceptance, checks, diff review, and report are complete.

## 7. Risk model

- `Low`: local, reversible, without durable-data or public-contract impact.
- `Medium`: bounded contract or behavior change with straightforward recovery.
- `High`: money, inventory, permissions, tenant data, migrations, external integrations, or production behavior.
- `Critical`: cross-tenant exposure, privilege escalation, irreversible corruption, financial/inventory history, major outage, secret compromise, or critical concurrency.

Low work needs targeted checks.
Medium work needs relevant typecheck, lint, unit, and integration checks.
High work needs database, integration, negative, and security evidence as applicable.
Critical work needs tenant, concurrency, authorization, audit, and idempotency evidence as applicable, plus explicit gate approval and recovery analysis.

## 8. Reusable task template

Every future task prompt or task record must contain:

```markdown
## ID
BCM-AREA-NNN

## Title
Short outcome-oriented title.

## Status and risk
Pending | In Progress | Blocked | Review | Completed
Low | Medium | High | Critical

## Objective
One concrete result.

## Why now
Dependency or risk that makes this the next coherent step.

## Dependencies
Completed task IDs and decision gates.

## Sources of Truth
AGENTS.md plus the exact applicable documents, ADRs, and domain decisions.

## Scope
Concrete behavior and artifacts included.

## Explicitly Out of Scope
Nearby work deliberately excluded.

## Expected Files / Areas
Likely repository areas; discovery may refine them without expanding scope.

## Security Considerations
Trust boundaries, permissions, secrets, session, file, or safe-error effects.

## Tenant Considerations
Organization derivation, Membership, scoping, constraints, RLS, and isolation tests.

## Database Considerations
Schema, migration, Decimal, transaction, locks, compatibility, and recovery, or “None”.

## Testing Requirements
Named levels, success/failure cases, and risk-specific checks.

## Acceptance Criteria
Observable conditions that establish completion.

## Required Commands
Exact relevant install/check/test/build/migration commands; never claim unrun commands.

## Review Checklist
Scope, diff, sources, invariants, security, tenant, data, tests, observability, and docs.

## Stop Condition
Stop after this task and report. Do not begin the next roadmap task.
```

If any field is unknown, the task is not Ready; do not fill it with an invented assumption.

## 9. Phase map

| Phase | Outcome | Detail horizon | Mandatory gate |
|---|---|---|---|
| 1. Repository & Tooling Bootstrap | Minimal pnpm monorepo, Web/API shells, checks, tests, env foundation, basic CI | Detailed | RG-01 |
| 2. Database Foundation | PostgreSQL/Prisma workflow, conventions, Identity/Tenant base schema, DB roles feasibility | Detailed | RG-02 |
| 3. Security & Identity | Passwords, sessions, cookies, CSRF, login/logout, identity UI and tests | Detailed | RG-03 |
| 4. Organizations, Memberships & RBAC | Current Organization, permission map, RLS context, switching, isolation proof | Detailed | RG-04 Critical |
| 5. Design System & Catalog Pattern | UI tokens/primitives plus one catalog vertical slice | Detailed/medium | RG-05 |
| 6. Equipment Inventory | Persistence, create/read, controlled update/archive, private photos | Medium | RG-06 |
| 7. Accessory Inventory | Product, stock, WAC, intake, adjustment, concurrency | Medium | RG-07 Critical |
| 8. Customers & Suppliers | Focused tenant-aware V1 records, no CRM or Purchasing | Medium | RG-08 |
| 9. Sales Draft & Calculation | Draft model, lines, money snapshots, authoritative calculation, real form | Medium | RG-09 |
| 10. Sale Confirmation | Atomic confirmation, locks, idempotency, inventory effects, audit | Medium | RG-10 Critical |
| 11. Sale Cancellation | Explicit compensating operation and concurrency proof | Medium | RG-11 Critical |
| 12. Reservations | Create, cancel, convert, and competing-operation protection | Medium | RG-12 Critical |
| 13. Trade-In | Atomic intake, profit correctness, and guarded cancellation | Medium | RG-13 Critical |
| 14. Payments & Financing Completion | Minimum approved payment/financing model and reconciliation | Coarse until decision | Decision gate + RG-14 |
| 15. Expenses, Warranty, Price List, Settings, Dashboard & Audit UI | Remaining V1 business capabilities and views | Coarse | Decision gates + RG-15 |
| 16. Operational Hardening | Sentry, metrics, redaction, release IDs, slow-query instrumentation | Coarse | RG-16 |
| 17. CI/CD Maturity | DB integration and E2E CI, artifact/release promotion | Coarse | RG-17 |
| 18. Staging | Managed environment, storage, secrets, migrations, synthetic data, uptime | Coarse | RG-18 |
| 19. Load & Performance | 10/20/40-user evidence and measured corrections | Coarse | RG-19 |
| 20. Backup & Disaster Recovery | PITR, isolated restore, object recovery, runbooks, rotation | Coarse | RG-20 blocking |
| 21. Production Readiness | Complete `PRODUCTION_READINESS.md` and close Critical findings | Coarse | RG-21 Critical |
| 22. First Production Deploy | Approved migration/API/Web release and post-deploy verification | Coarse | RG-22 Critical |
| 23. Post-launch Stabilization | Real BCM defects, usability, measured performance, operational pain | Coarse | RG-23 |
| 24. Deferred Capabilities | New business decisions and later product evolution | Coarse | New decision gates |

Basic CI is deliberately in Phase 1; Phase 17 matures deployment automation rather than introducing CI late.
Observability foundation begins in Phase 1; provider integrations mature in Phases 16 and 18.

## 10. Dependency graph

```text
Repository bootstrap
        ↓
Database foundation
        ↓
Identity and session security
        ↓
Organizations / Memberships / RBAC / RLS
        ↓
Catalog proof slice ──────── Design System foundation
        ↓                              ↓
Equipment inventory ───────────── Feature UI primitives
        ↓
Accessory inventory concurrency
        ↓
Customers and Suppliers
        ↓
Sales Draft and money calculation
        ↓
Sale confirmation
        ↓
Sale cancellation
        ↓
Reservations
        ↓
Trade-In
        ↓
Remaining V1 views and settings
        ↓
Staging → Load → Restore → Readiness → Production
```

```text
Testing  ─────────────────────────────────────────────► every phase
Security ─────────────────────────────────────────────► every phase
Tenant isolation ─────────────────────────────────────► every business slice
Observability foundation ─────────────────────────────► incremental maturity
Basic CI ─────────► DB integration CI ────────────────► E2E/release CI
```

Customers may begin after RG-04 and run alongside Inventory only after contracts are independent.
Suppliers may run alongside Customers because Purchasing is out of scope.
Design System foundation may run alongside database/identity work after Web bootstrap, but it must finish before feature screens multiply.
Critical domain contracts, migrations, and shared APIs remain sequential.

## 11. Mandatory Review Gates

| Gate | Stop after | Required evidence before approval |
|---|---|---|
| RG-01 Repository Bootstrap | Phase 1 | Clean minimal repo; frozen install; lint, typecheck, test, build; no empty business modules; basic CI green |
| RG-02 Database Foundation | Phase 2 | Naming, UUID, timestamps, Decimal mapping, migration workflow, tenant FK pattern, runtime/migration roles, RLS feasibility |
| RG-03 Identity | Phase 3 | Cookie settings, token hashing, persistence, CSRF, rate limiting, safe errors/logs, negative security tests |
| RG-04 Tenant Isolation | Phase 4 | App scoping, Membership validation, Prisma pattern, transaction-local RLS, fail-closed, role grants, pool leakage and cross-tenant tests |
| RG-05 Catalog Pattern | First catalog slice | Backend module shape, REST conventions, frontend feature/form pattern, permissions, validation, isolation, no over-abstraction |
| RG-06 Equipment | Equipment slice | Model/indexes, IMEI uniqueness, state commands, tenant/API/UI/files/tests/observability |
| RG-07 Accessory Concurrency | Accessory inventory | Real competing intake/adjustment/sale-precondition operations; stock never negative; WAC exact; movements consistent |
| RG-09 Sale Draft | Draft and calculation | Model, snapshots, Decimal rules, lines, UX, permissions, pending decisions resolved |
| RG-10 Sale Confirmation | ConfirmSale | Transaction, stable locks, deadlock analysis, idempotency, snapshots, inventory/movements, audit, negative and concurrent tests |
| RG-11 Cancellation | CancelSale | Double-cancel concurrency, exact compensation, no duplicate stock, preserved history, dependency blocking |
| RG-12 Reservations | Reservation flows | Two reservations, reservation-vs-sale, double conversion, Customer rule, history and audit |
| RG-13 Trade-In | Trade-In flows | Atomic intake, origin/cost snapshots, no profit double count, guarded reversal, Manual Resolution Required |
| RG-18 Staging | First staging candidate | Core E2E, cross-tenant, concurrency, uploads, migrations, security, observability, backup status |
| RG-20 Restore | DR validation | Successful isolated PostgreSQL restore, RLS/roles/invariants check, object recovery evidence, runbooks |
| RG-21 Production Readiness | Production candidate | Completed readiness document, no Critical blockers, scope/security/test/load/backup/support approval |
| RG-22 First Production Deploy | Deployment | Explicit approval, staging green, healthy backup, smoke checks, metrics/errors reviewed |

Failure of RG-04 stops all commercial modules.
Failure of RG-10 stops cancellation, Reservations, and Trade-In.
Failure of RG-20 blocks production.
Passing a gate records evidence and returns control to the user.

## 12. First implementation task

### BCM-FND-001 — Root pnpm and Node workspace contract

- **Status / Risk:** Completed / Low.
- **Objective:** establish only the root workspace/runtime contract required for later Web and API bootstraps.
- **Why now:** every later install, script, and package depends on one package-manager and runtime baseline.
- **Dependencies:** BCM-012 Completed.
- **Sources:** `AGENTS.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, ADR-002.
- **Scope:** root package metadata, pnpm workspace declaration, Node 24/pnpm version contract, root script names prepared only where executable, and minimal repository instructions.
- **Out of scope:** React, Vite, NestJS, Prisma, business code, CI, databases, Docker, shared packages, and speculative scripts.
- **Expected areas:** root `package.json`, `pnpm-workspace.yaml`, runtime/version configuration, and minimal README adjustment if required.
- **Security / tenant / database:** no application trust boundary, tenant data, or database change.
- **Tests:** validate package manifests, workspace discovery, version enforcement, and repository cleanliness.
- **Acceptance:** one package manager, no alternate lockfile, Node 24 declared, workspace paths explicit, no feature code, and a small auditable diff.
- **Required commands:** task prompt must select non-destructive version/workspace validation commands; install is authorized only in that future task.
- **Review:** inspect every generated file and dependency; confirm no framework bootstrap.
- **Stop:** report BCM-FND-001 only and do not start BCM-FND-002.

This is intentionally smaller than “bootstrap the monorepo.”

### BCM-012A — Customer Business Decisions Reconciliation

- **Status / Risk:** Completed / Critical (documentation decisions governing future money, inventory history, permissions, and destructive operations).
- **Objective:** reconcile confirmed customer answers into Product, Domain, Database impact, Security/RBAC, and this roadmap before affected commercial implementation.
- **Dependencies:** BCM-012 Completed and confirmed customer answers supplied with BCM-012A.
- **Scope completed:** category cardinality; individual/quantity tracking and iPhone IMEI; Equipment physical delete versus write-off; minimum stock; quick intake; Sale Correction/business void; Trade-In status/multiplicity; Reservation duration/refund reminder; Financing/Warranty/Expenses; duplicate Customers; text Price List; Dashboard economics; sensitive RBAC.
- **Acceptance:** confirmed rules recorded without inventing unresolved details; contradictions reconciled; new Pending gates identified; only approved documentation changed; no schema, migration, dependency, code, CI, Docker or infrastructure work started.
- **Review gate:** BCM-012A mandatory business-decision review completed. Each future implementation remains Pending and subject to its own decision/review gate.
- **Architecture Review Required:** before implementing new Expenses, Warranty, or Financing module ownership; BCM-012A did not change accepted architecture.

## 13. First ten implementation tasks

| Order | ID | Title | Dependency | Primary output | Gate |
|---:|---|---|---|---|---|
| 1 | BCM-FND-001 | Root pnpm and Node workspace contract | BCM-012 | Root workspace/runtime metadata | — |
| 2 | BCM-FND-002 | Shared strict TypeScript, lint, and format foundation | FND-001 | Minimal approved quality configuration | — |
| 3 | BCM-API-001 | Minimal NestJS API bootstrap | FND-002 | Bootable API shell, config boundary, no business modules | — |
| 4 | BCM-WEB-001 | Minimal React/Vite Web bootstrap | FND-002 | App entry, Router Data Mode, providers, error boundary, query client | — |
| 5 | BCM-TST-001 | Unit/component test runner foundation | API-001, WEB-001 | Vitest, RTL/user-event boundaries and example foundation tests | — |
| 6 | BCM-FND-003 | Environment validation foundation | API-001, WEB-001 | Typed server/public config boundaries with test-safe defaults | — |
| 7 | BCM-OBS-001 | Request ID, structured logger, safe API error foundation | API-001, FND-003 | Pino adapter, correlation, global safe errors, basic health | — |
| 8 | BCM-CI-001 | Basic GitHub Actions quality pipeline | FND-001..003, TST-001, OBS-001 | Frozen install, lint, typecheck, unit tests, build | RG-01 |
| 9 | BCM-DB-001 | PostgreSQL local/test and Prisma workflow foundation | RG-01 | Approved dependencies, connection/config, migration/test workflow | — |
| 10 | BCM-DB-002 | Database conventions and initial schema primitives | DB-001 | UUID/timestamps/Decimal/naming conventions and migration proof | RG-02 part 1 |

Every task is issued separately using the full task template.

## 14. Detailed near-term backlog

The first 25 tasks are planned in greater detail. Scope is refined at task start without changing dependencies or inventing rules.

| ID | Status | Risk | Dependencies | Outcome and acceptance focus |
|---|---|---|---|---|
| BCM-FND-001 | Completed | Low | BCM-012 | Root pnpm/Node 24 workspace contract; no frameworks |
| BCM-FND-002 | Completed | Medium | FND-001 | Strict TS strategy, approved lint/format setup, executable root checks |
| BCM-API-001 | Completed | Medium | FND-002 | Minimal NestJS bootstrap and module layout; no empty business modules |
| BCM-WEB-001 | Completed | Medium | FND-002 | Minimal React/Vite entry, router, provider composition, error boundary, query client, placeholder shell only |
| BCM-TST-001 | Completed | Medium | API-001, WEB-001 | Vitest on both sides; RTL/user-event for Web; no permanent mock architecture |
| BCM-FND-003 | Completed | High | API-001, WEB-001 | Fail-fast environment validation; secrets server-only; `VITE_*` public boundary explicit |
| BCM-OBS-001 | Completed | High | API-001, FND-003 | Pino adapter, request IDs, safe errors, liveness/readiness foundation, redaction tests |
| BCM-CI-001 | Completed | Medium | FND-001..003, TST-001, OBS-001 | GitHub Actions frozen install, lint, typecheck, unit, build; RG-01 evidence |
| BCM-DB-001 | Completed | High | RG-01 | PostgreSQL local/test strategy, Prisma setup, isolated test DB workflow; no SQLite |
| BCM-DB-002 | Completed | High | DB-001 | UUID/timestamp/Decimal/naming primitives and first reviewed migration workflow |
| BCM-DB-003 | Completed | High | DB-002 | Organization, User, Membership, Session, credential/security-table persistence foundation only |
| BCM-DB-004 | Completed | Critical | DB-003 | Runtime/migration role grants, tenant-aware FK pattern, transaction-local RLS feasibility proof; RG-02 |
| BCM-SEC-001 | Completed | Critical | RG-02 | Argon2id credential service, password rules, disabled-user behavior, safe unit/integration tests |
| BCM-SEC-002 | Completed | Critical | SEC-001 | Opaque session creation/validation/revocation, token hash only, idle/absolute expiry |
| BCM-SEC-003 | Completed | Critical | SEC-002 | Login/logout/session endpoints, HttpOnly cookie lifecycle, safe 401 behavior, audit hooks |
| BCM-SEC-004 | Completed | Critical | SEC-003 | CSRF, Origin/Referer, identity rate limiting, safe 401/403/error behavior, negative security tests |
| BCM-WEB-002 | Completed | High | SEC-003, SEC-004, WEB-001 | Real login, session bootstrap, logout, 401/403 distinction, auth cache cleanup; RG-03 |
| BCM-TEN-001 | Completed | Critical | RG-03, DB-004 | Resolve Organization from session and active Membership; fail closed and repository context contract |
| BCM-TEN-002A | Completed | Critical | TEN-001 | Durable RBAC V1 role/permission, Owner-invariant and stale-session decisions; resolves TEN002-B001/B002 without runtime implementation |
| BCM-TEN-002 | Pending | Critical | TEN-001, TEN-002A | Central role-to-permission map, authorization version, semantic guards, deny-default tests |
| BCM-TEN-003 | Pending | Critical | TEN-001, TEN-002 | First tenant-owned probe resource with application scope + transaction-local RLS + pool leakage tests |
| BCM-TEN-004 | Pending | Critical | TEN-003, WEB-002 | Organization switch, Membership revalidation, query-key scoping and complete cache clearing; RG-04 |
| BCM-DS-001 | Pending | Medium | WEB-001 | Complete `DESIGN_SYSTEM.md` foundation: tokens, typography, spacing, core form/table/feedback/responsive patterns |
| BCM-DEC-CAT-001 | Pending | High | RG-04 | Resolve catalog historical lifecycle and required manual-intake data before persistence; no code |
| BCM-CAT-001 | Pending | High | RG-04, DS-001, DEC-CAT-001 | One selected catalog end-to-end: DB, repository, permission, REST, real list/form, isolation/tests; RG-05 |

RG-01 is **Approved** and follows BCM-CI-001.
RG-02 is **Approved** and follows BCM-DB-004, not merely the first migration.
RG02-F001 (runtime database identity fail-fast assertion) is **Resolved** by BCM-SEC-002 with real PostgreSQL evidence.
RG-03 is **Approved with follow-ups** and follows BCM-WEB-002 and all identity security tests.
RG03-F001 (confirmed session-loss cache isolation) is **Resolved** by the centralized Web session-loss transition with bootstrap, refetch, mutation, CSRF-recovery, and User A-to-User B regression evidence.
RG03-F002 (`SECURITY.md` database-review status alignment) is **Resolved** against the completed BCM-005 database review and approved RG-02.
RG03-F003 (durable governance record for unverifiable RG-02 findings) is **Resolved** by `docs/reviews/RG-02-FINDINGS-RECORD.md` without reconstructing unavailable history.
RG03-F004 remains **Pending**.
RG03-F005 (versioned durable browser validation evidence) is **Resolved** by `docs/reviews/RG-03-BROWSER-EVIDENCE.md` without adding automation or sensitive artifacts.
BCM-TEN-001 closes session-derived tenant authority, active Membership revalidation, and tenant-bound persistence scope. It does not complete semantic RBAC/authorization-version enforcement (BCM-TEN-002), product-table RLS (BCM-TEN-003), Organization switching (BCM-TEN-004), or RG-04.
BCM-TEN-002A records the approved V1 role/permission matrix, Owner invariants and fail-closed authorization-version renewal policy. TEN002-B001 and TEN002-B002 are **Resolved** as decisions; BCM-TEN-002 remains **Pending** until its technical implementation and review are complete.
RG-04 follows BCM-TEN-004 and is the hard boundary before business data.
RG-05 follows BCM-CAT-001 and may require a bounded refactor before pattern replication.

## 15. Phase 1 — Repository and Tooling Bootstrap

Milestones:

1. Root pnpm workspace and Node 24 contract.
2. Strict TypeScript, lint, and formatting strategy shared only where real consumers exist.
3. Minimal NestJS API bootstrap with config boundary.
4. Minimal React/TypeScript/Vite Web bootstrap with Router Data Mode and TanStack Query.
5. Vitest foundation for API and Web; RTL/user-event for component behavior.
6. Environment validation with strict public/server separation.
7. Request ID, Pino logger adapter, safe error boundary, and health foundation.
8. Basic GitHub Actions checks using frozen install.
9. RG-01 Repository Bootstrap.

The bootstrap must make `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` meaningful when their consumers exist.
Do not create all possible packages. A package is added only with immediate ownership and at least one real consumer.
Do not create 30 screens, business module shells, Docker/Kubernetes, Prisma, or provider infrastructure here.

## 16. Phase 2 — Database Foundation

Milestones:

1. Document and implement the PostgreSQL local/test strategy.
2. Install/configure Prisma only in its authorized task.
3. Establish reviewed migration commands and real-PostgreSQL integration isolation.
4. Prove UUID, timestamps, `numeric`/Decimal, naming, and index conventions.
5. Add the minimal Organization/User/Membership/Session/security persistence required by Identity and Tenancy.
6. Prove tenant-aware FK patterns and transaction-local RLS feasibility with separate roles.
7. Extend CI with migration and PostgreSQL integration checks after those checks exist.
8. RG-02 Database Foundation.

Do not build every business table in one migration.
Schema additions generally receive their own task or a clearly bounded vertical-slice migration.

## 17. Phase 3 — Security and Identity

Milestones:

1. Argon2id password hashing and credential validation.
2. Opaque server-side sessions stored only by token hash.
3. Secure host-only HttpOnly SameSite=Lax cookies and revocation.
4. Login, logout, session bootstrap, disabled-account behavior, and safe errors.
5. CSRF token plus Origin/Referer defense.
6. Local identity rate-limit adapter plus persistent abuse/recovery state where specified.
7. Real Web login and session experience with separate 401/403 behavior.
8. Integration/security tests for invalid credentials, expiry, revocation, CSRF, and rate limit.
9. RG-03 Identity.

MFA, separate general email verification, Platform Super Admin, SSO, and distributed rate-limit infrastructure are not part of this phase unless their documented trigger fires.

## 18. Phase 4 — Organizations, Memberships, RBAC, and RLS

Milestones:

1. Active Membership revalidation and server-derived current Organization.
2. Central code-defined permission mapping and semantic authorization helpers.
3. Authorization-version/session invalidation behavior.
4. Repository scoping and same-Organization relationship validation.
5. Transaction-local tenant RLS context that fails closed.
6. Runtime role without owner/DDL/`BYPASSRLS`; separate migration/admin capabilities.
7. End-to-end Organization A ≠ Organization B isolation proof using actual pool mode.
8. Organization switching and tenant-aware Web cache cleanup.
9. RG-04 Tenant Isolation.

Candidate RLS policies are added only as tenant-owned tables exist.
The proof resource is minimal and is removed or adopted intentionally; it cannot become an unexplained parallel model.

## 19. Phase 5 — Design System and Catalog Foundation

Design System foundation begins after WEB-001 and may run safely beside DB/Identity work.
It must complete before business screens proliferate.
It defines visual tokens, typography, spacing, form/table/feedback primitives, responsive patterns, and accessibility practices without redesigning the whole product.

Before catalog code, resolve:

- DOM-DEC-023: edit/deactivate/history behavior for used catalog values.
- relevant part of DOM-DEC-040: required input data for manual inventory entry.

Choose one necessary catalog as the pattern proof; do not build a generic settings engine.
The slice includes persistence, repository, use case, permission, REST, Web list/form, tests, tenant isolation, and observability.
RG-05 reviews over-architecture before repeating the pattern for brand, model, category, capacity, color, and condition catalogs.

## 20. Phase 6 — Equipment Inventory

### Milestone 6.1 — Persistence

- Equipment model and tenant-aware IMEI uniqueness.
- Approved state representation and origin, including `WrittenOff` for theft/loss.
- One required Category and reusable tracking/IMEI policy; iPhone requires individual IMEI.
- Specific historical cost and exact catalog relationships.
- Audit timestamps and query indexes.
- Migration, constraint, and database tests.

Resolve DOM-DEC-037/040 where their unknown state/intake rules block the slice.

### Milestone 6.2 — Create and read slice

- Create Equipment semantic command.
- Bounded server-side list/search and detail.
- Permissions, validation, tenant isolation, REST, real Web UI, tests, and safe logs.
- No Sale or Reservation effect yet.

### Milestone 6.3 — Controlled update and archive

- Separate editable attributes from state transitions.
- No generic status-update endpoint.
- Resolve DOM-DEC-022/037 before Archived/Under Review transitions.

### Milestone 6.4 — Private photos

- Tenant-owned metadata, private storage adapter, MIME/size/key validation, signed access, gallery, tests.
- Development/test storage strategy may precede provider choice without making files public.
- Provider provisioning waits for the current provider decision gate.

### Milestone 6.5 — Write-off and safe erroneous-record deletion

`BCM-INV-010 — Equipment write-off and safe deletion` remains Pending after the base lifecycle exists. Theft/loss creates `WrittenOff` + movement; physical delete requires proof of no commercial history/dependency, a dedicated permission, reason and audit. It must include negative DB/API tests and must never become a generic Equipment delete.

RG-06 reviews the entire Equipment pattern before Accessories.

## 21. Phase 7 — Accessory Inventory

Required decision gate before persistence:

- DB-DEC-002 / SKU uniqueness by Organization.
- DB-DEC-003 + DOM-DEC-046 / Accessory lifecycle.
- DOM-DEC-027 / whether zero cost is valid, if the intake contract needs it.
- DOM-DEC-039/040 / adjustment permissions/evidence and manual intake data.

Milestones:

1. Accessory Product persistence, status, SKU, quantity, WAC, and movements.
2. Configurable `minimum_stock` and low-stock alert at `current_stock <= minimum_stock`.
3. Atomic intake command updating quantity, moving weighted average cost, and movement.
4. Explicit manual adjustment with reason, permission, User, audit, and no-negative constraint.
5. Real Web list/create/detail/intake/adjust/low-stock experience.
6. Decimal/database tests and actual competing mutations.
7. RG-07 Accessory Concurrency: stock never negative and WAC/movements remain exact.

Never expose a generic stock-update endpoint.

## 22. Phase 8 — Customers and Suppliers

### Customers

Resolve DOM-DEC-024 and DOM-DEC-044 before implementing deactivate/anonymize or historical Sale snapshots.
Deliver persistence, create, search, list/detail, permitted edit/deactivate, permissions, tenant isolation, Web UI, and tests.
Candidate duplicate warnings are required; a blocking UNIQUE waits for BCM-DEC-CUS-002 to select a strong identifier. Name alone never blocks.
Do not build a CRM.
Do not implement “create within Sale” until the Sale form exists; prepare only genuinely reusable contracts/components.

### Suppliers

Deliver basic V1 persistence, list/detail, permitted maintenance, authorization, isolation, UI, and tests.
Do not implement Purchasing, supplier returns, imaginary order tables, or future financing.

Customers and Suppliers may proceed in parallel after RG-04 when they do not share an unsettled contract.

## 23. Phase 9 — Sales Draft and Money Calculation

Mandatory decisions before schema or calculation:

- DB-DEC-001 + DOM-DEC-025/042: minimum Payment cardinality/reconciliation and Trade-In overpayment behavior.
- DB-DEC-011 + DOM-DEC-063: Financing V1 depth and compatible persistence, even if the bounded financing slice follows later.
- DB-DEC-005 + DOM-DEC-014: exchange-rate convention, precision, and rounding moments.
- DOM-DEC-027: zero/unknown cost distinction when relevant.
- DOM-DEC-030/045: discounts and zero-price authorization if exposed.
- DOM-DEC-043: empty Sale validity.
- DOM-DEC-044: Customer historical snapshot.

Milestones:

1. Sale Draft persistence with numbering strategy, optional Customer, currency, specialized lines, payment foundation, and snapshot fields.
2. Draft commands for Equipment/Accessory lines, prices, removal, and Customer selection without final inventory effects.
3. Quick Create / Quick Inventory Intake inside Sale UX using the real inventory command before a line can be confirmed; abandoning the Sale leaves a valid inventory record.
4. Authoritative backend Decimal calculation for totals, USD conversion, costs, and Gross Profit preview/final semantics.
5. Contract-first request/response/error definition proportional to risk.
6. Real Sale form using available Equipment, quantities, Customer selection/create, approved payment/currency/rate, and totals.
7. Intensive Decimal, validation, permission, tenant, and API/UI integration tests.
8. RG-09 Sale Draft.

Frontend never confirms optimistically and never becomes monetary authority.

## 24. Phase 10 — Sale Confirmation

Implement `ConfirmSale` as an explicit Critical use case.
Within one short database transaction:

1. Revalidate session, Organization, Membership, and semantic permission.
2. Claim persistent idempotency and verify request fingerprint.
3. Lock records in stable order.
4. Revalidate Equipment availability and Accessory stock.
5. Recalculate and freeze monetary, exchange-rate, price, and cost snapshots.
6. Decrement Accessory quantities without allowing negative stock.
7. Transition Equipment to Sold.
8. Create inventory movements, approved Payments, and Audit Event.
9. Transition Sale to Confirmed.

No external network call occurs inside the transaction.
Required tests cover Equipment, Accessory, mixed Sale, gifts when approved, Decimal money, tenant, permission, idempotency, insufficient stock, sold Equipment, concurrent unit sale, concurrent stock, rollback, and safe errors.
RG-10 is Critical and blocks every dependent commercial operation.

## 25. Phase 11 — Sale Cancellation

Implement cancellation separately from confirmation.
The command verifies Confirmed state and reversibility, is persistently idempotent, locks affected records, creates compensating movements, restores eligible Equipment/Accessory effects exactly once, preserves the original Sale, stores reason/User/time, audits, and marks Cancelled.
Later dependencies block automatic compensation and produce `Manual Resolution Required`.

Tests include concurrent double cancellation, repeated idempotent request, already-cancelled behavior, later dependency, exact stock restoration, tenant/permission denial, and transaction rollback.
RG-11 blocks further dependent work until it proves stock cannot duplicate.

`BCM-SAL-010 — Sale Correction` remains Pending after the base confirmation/cancellation model. It requires BCM-DEC-SAL-004 and BCM-DEC-AUD-001, preserves the original/version history, applies idempotent compensating deltas, blocks non-reversible dependencies, and presents UX “Editar venta.” It is not part of the cancellation task and has not started.

## 26. Phase 12 — Reservations

Resolve before relevant behavior:

- DOM-DEC-058 for deposit execution beyond storing the approved refundable snapshot foundation.
- DOM-DEC-007 is confirmed for chosen expiry + alert; DOM-DEC-058 still blocks automatic lifecycle/refund effects.
- DOM-DEC-038 for modification; do not invent extension/customer/equipment change.
- DOM-DEC-053 for what cancellation of a Sale converted from Reservation does.

Milestones:

1. Reservation persistence with Active/Converted/Cancelled, mandatory Customer, one Equipment, chosen `expires_at`, and refundable-deposit foundation limited by approved rules.
2. Create: lock Available Equipment, create Active, transition to Reserved, audit/movement if required by source.
3. Cancel: Active only, release Equipment, retain history, audit.
4. Convert: same Customer, one conversion, Equipment still reserved by that Reservation, and approved Sale flow.
5. Expiry alert/reminder that performs no automatic financial action or Equipment release.
6. Real UI and tests for two reservations, reservation-vs-sale, double conversion, expiry clock, tenant, permissions, and rollback.
7. RG-12 Reservations.

Do not implement Accessory reservations in V1 without resolving DOM-DEC-008.

## 27. Phase 13 — Trade-In

Mandatory decision gate:

- DB-DEC-004 + DOM-DEC-041 are resolved: received Equipment starts `Available`.
- DOM-DEC-012 is confirmed: persistence and contract support Sale 1:N Trade-In.
- DOM-DEC-042: value exceeding Sale total.
- DOM-DEC-049: later repair/reconditioning cost treatment if exposed.
- DOM-DEC-054: authorized manual resolution and evidence.

Milestones:

1. Add approved one-or-many Trade-In data to the Sale contract with mandatory Customer.
2. Atomically create every received Equipment as `Available`, snapshot each take value/cost, retain Sale origin, reduce balance by the total, and confirm Sale.
3. Protect Gross Profit USD from double-counting take value.
4. Implement guarded cancellation only when all downstream elements are reversible.
5. Return `Manual Resolution Required` without deleting or rewriting downstream operations.
6. Test money examples, atomic failure, origin, concurrency, tenant, authorization, and cancellation dependencies.
7. RG-13 Trade-In.

## 28. Phase 14 — Payments & Financing Completion

`DB-DEC-001`, `DOM-DEC-025`, and `DOM-DEC-042` block Payment implementation beyond an explicitly approved minimum.
Create `BCM-DEC-SAL-001 — DECISION GATE: V1 Payment model` before Sales persistence.
The decision must define cardinality, combined/partial payments, reconciliation with Sale total and Trade-In, references, and allowed future extension.
Financing is a confirmed required capability, but `DOM-DEC-063` and DB-DEC-011 block its V1 depth. `BCM-DEC-FIN-001 — DECISION GATE: V1 Financing depth` must decide whether V1 stores only agreed installment/interest/surcharge conditions or also schedules, due dates, collections and statuses. Do not invent scoring, debt collection, lender integration, accounting, or a generic credit platform.

`BCM-FIN-001 — Bounded V1 Financing` remains Pending after the payment gate and base Sale contract. It supports only the approved occasional-use depth, explicit permissions, immutable financial snapshots and reconciliation tests. Payment/Financing expansion is a separate vertical slice with migration compatibility and its own RG-14.

## 29. Phase 15 — Remaining V1 business capabilities

### Expenses

`BCM-DEC-EXP-001 — DECISION GATE: Expense taxonomy and investment treatment` resolves DOM-DEC-066/DB-DEC-012 before persistence.
`BCM-EXP-001 — Expense register and correction/void` remains Pending: tenant-owned recorded expenses, currency snapshots, category/date/actor/reason, sensitive permissions and preserved history.
Dashboard consumes authoritative Expense records; no accounting platform, cash register or ledger-general is implied.

### Warranty

`BCM-DEC-WAR-001 — DECISION GATE: Warranty defaults and V1 lifecycle` resolves DOM-DEC-064/DB-DEC-010.
`BCM-WAR-001 — Supplier Warranty visibility` remains Pending and must expose Equipment purchase/receipt date, duration/expiry and current validity without conflating Customer Warranty.
Any `BCM-WAR-002 — Customer Warranty baseline` remains Pending behind the same gate and covers only the approved Sale-linked coverage, not an advanced claims/repair platform.

### Price List

List only commercially available products and authorized fields; never expose costs.
Start with render/copy/shareable output.
DOM-DEC-036 is confirmed: V1 output is ordered text ready to copy/send by WhatsApp.
PDF, image or other export is a later bounded slice; no universal reporting engine and no required direct WhatsApp integration.

### Settings

Implement only settings already consumed by a feature.
Suggested exchange-rate changes affect only new operations and never rewrite historical snapshots.
Resolve DOM-DEC-051 before selecting convention/source/update permission.
Do not create a generic settings platform.

### Dashboard

DOM-DEC-032 confirms high-priority V1 filters day/week/month/custom range and the minimum Revenue, Gross Profit, Expenses, Business Result, quantities, best-seller and per-product/total margin metrics in ARS/USD.
`BCM-DASH-001 — V1 Business Dashboard baseline` remains Pending after Sales, Expenses and monetary convention gates. Use authoritative Sales/inventory/Expense facts; do not add analytics infrastructure prematurely or call Business Result “Net Profit.”

### Audit UI

Audit storage exists incrementally before its query UI.
Deliver `audit.read`, bounded pagination, allowlisted filters, tenant scope, and safe before/after rendering.
Do not expose secrets, session tokens, internal security records, or cross-tenant identifiers.
Resolve additional retention/action detail under DOM-DEC-033 when required.

RG-15 confirms all PRODUCT V1 capabilities, sensitive financial permissions and remaining decisions are accounted for.

## 30. Observability maturity

### Foundation — Phase 1

- Request ID generation/propagation.
- Pino adapter and structured safe fields.
- Safe global errors and liveness/readiness foundation.
- Redaction tests.

### Incremental — every feature

- Semantic operation/outcome/duration logs.
- Durable Audit Events for business/security evidence.
- Useful error context without secrets or high-cardinality metrics.
- Query/transaction timing where risk warrants it.

### Staging — Phases 16–18

- Sentry with release/environment and private source-map handling.
- Provider metrics and slow-query instrumentation, initially configurable at 250 ms.
- External uptime, deploy markers, owned alerts, and runbooks.

### Future trigger

OpenTelemetry remains deferred until cross-service tracing, provider portability, or demonstrated diagnostic need justifies it.
Do not introduce self-hosted Prometheus/Grafana in V1.

## 31. CI/CD maturity

### Basic CI — Phase 1

Frozen install, lint, typecheck, unit/component tests, and build after scripts are real.

### Database CI — Phase 2 onward

Real PostgreSQL integration, empty-to-latest migrations, representative upgrade, RLS/grant checks, and isolated test workers.

### Business CI — Feature phases

Relevant integration, negative, tenant, concurrency, and selected Playwright tests.

### Release CI — Before staging

Reproducible artifact, security/secret checks, migration stage, staging promotion, release markers, and production environment approval.
No untrusted PR receives secrets.
Do not configure these pipelines before the commands and environments they execute exist.

## 32. Phase 18 — Staging and provider decisions

Before provisioning, execute `BCM-DEC-OPS-001 — DECISION GATE: Managed provider selection` using current evidence for:

- static Web host;
- managed Node/OCI API host;
- managed PostgreSQL with PITR;
- private S3-compatible object storage;
- API/DB region and network;
- plans, cost, connection pooling, rollback, and backup/restore capabilities;
- Sentry, provider metrics, uptime, and alert channel.

Do not freeze vendor names, prices, regions, or plan capabilities in this roadmap.
Revalidate DEP-DEC-003/004/005/006/007/011/012 when procurement begins.

Staging provisions separate Web, API, PostgreSQL, storage, secrets, Sentry environment, metrics, and uptime.
Validate fresh migrations, runtime role, RLS, pool behavior, synthetic seed data, private uploads, core E2E, cross-tenant negatives, concurrency, security, and observability.
RG-18 must pass before load or production readiness.

## 33. Performance validation

Run documented mixed workloads at 10, 20, and 40 concurrent users.
Include independent browsing, bounded search/listing, Sale confirmation, concurrent stock pressure, and realistic mixed work.
Observe latency, error rate, saturation, query plans, slow queries, locks, pool use, CPU/memory, and browser bundles.

Tune only from evidence, preferring:

1. query or N+1 correction;
2. index or pagination improvement;
3. connection-pool configuration;
4. API/DB instance sizing;
5. bounded payload/cache headers where semantically safe.

Do not jump to Redis, replicas, workers, microservices, or a search service.
RG-19 records before/after evidence and remaining capacity risk.

## 34. Backup and disaster recovery

Before production:

- confirm PostgreSQL PITR plan and recovery window;
- confirm private object-storage recovery/versioning/lifecycle strategy;
- perform a restore into an isolated non-production environment;
- validate schema, migrations, extensions, grants, runtime role, RLS, key counts, and domain invariants;
- test application startup and safe access against the restored environment;
- document database restore, provider outage, bad deploy/migration, and compromised-secret runbooks;
- exercise secret rotation procedure;
- record evidence and safely destroy the temporary restore.

RG-20 blocks production until restore succeeds.
Internal objectives remain RPO ≤ 15 minutes and RTO ≤ 4 hours subject to the selected plan and explicit production acceptance.

## 35. Production Readiness and first deployment

Complete `docs/PRODUCTION_READINESS.md` in a dedicated future task after staging/load/restore evidence exists and before production approval.
Review V1 scope, invariants, pending decisions, tenant/security controls, tests, migrations, backups, observability, load, accessibility, support, runbooks, and residual risk.
No production deploy occurs with a Critical blocker.

The first deploy process is planned, not executed here:

1. explicit production approval;
2. staging green and release artifact identified;
3. backups/PITR healthy and recovery evidence current;
4. compatible production migration using migration identity;
5. API deployment and readiness verification;
6. Web deployment and contract-compatible smoke tests;
7. Sentry/metrics/logs/uptime and release markers reviewed;
8. post-deploy checklist and rollback readiness;
9. recorded outcome and RG-22 approval.

Deploy through pipeline/provider, never `git pull`.

## 36. V1 path

These categories sequence delivery; they do not silently remove anything from PRODUCT scope.

### Required for the first usable BCM production release

- secure Identity, sessions, and recovery foundations required by SECURITY;
- Organizations, Memberships, RBAC, current Organization, and proven tenant isolation;
- required catalogs and business settings;
- Equipment inventory, Accessory inventory, stock movements, WAC, and private product photos where required by PRODUCT;
- Equipment write-off/delete-safe rules and configurable minimum-stock alerts;
- Customers and basic Suppliers;
- Sale Draft with quick valid inventory intake, authoritative money, confirmation, approved Payment minimum, cancellation and gated Sale Correction;
- Reservations and conversion to Sale under resolved rules;
- one-or-many Trade-In intake to `Available`, profit, origin, and guarded cancellation;
- Expense register and internal Business Result;
- Supplier Warranty visibility and the Customer Warranty baseline approved by its gate;
- bounded Financing capability approved by its gate;
- available-only Price List;
- high-priority Dashboard baseline only after Sales/Expenses and monetary decision gates;
- functional Audit Events and authorized audit consultation required for operation;
- real tests, CI, observability, staging, load evidence, PITR/restore, runbooks, and production approval.

### Can follow as bounded V1 improvements after the first usable internal increment

- richer Price List export after basic render/copy;
- additional catalog administration conveniences based on real use;
- richer Dashboard presentation after metric definitions are stable;
- non-blocking Audit UI refinements;
- product-photo workflow refinements that do not weaken private storage.

These items remain part of V1 if PRODUCT acceptance requires them before production; moving one after launch needs explicit product approval.

### Explicitly deferred beyond V1

- full Returns and Exchanges;
- credit scoring, collections platform, lender integration and financing beyond the approved V1 depth;
- advanced Warranty claims, repairs and supplier-return automation beyond the approved baseline;
- supplier Purchasing and supplier-return workflows;
- branches, transfers, and multi-location stock;
- promotions, advanced discounts, and taxes without decisions;
- automatic financial action on Reservation expiry and advanced deposit rules;
- cash-register/accounting workflows;
- advanced reporting/analytics beyond the measurable Dashboard baseline;
- Elasticsearch, Redis, workers, brokers, microservices, and other technical non-goals.

Production V1 is not a demo MVP: security, tenancy, tests, backups, observability, and operational readiness are mandatory even at low user count.

## 37. Decision gates

Decision tasks change source documents through separately authorized work; they do not implement code.

| Gate | Open decision | Blocking deadline |
|---|---|---|
| BCM-DEC-CAT-001 | DOM-DEC-023 catalog history; relevant DOM-DEC-040 intake requirements; DB-DEC-007 tracking/IMEI policy | Before first catalog/inventory migration |
| BCM-DEC-INV-001 | Remaining DOM-DEC-037/040 Equipment state/manual intake; DOM-DEC-022 before archive; `WrittenOff` and safe physical-delete contract are confirmed | Before affected Equipment milestone |
| BCM-DEC-INV-002 | DB-DEC-002 SKU uniqueness; DB-DEC-003 + DOM-DEC-046 Accessory lifecycle; DOM-DEC-027 if zero cost accepted | Before Accessory schema |
| BCM-DEC-INV-003 | DOM-DEC-039 adjustment permissions/evidence | Before manual stock adjustment |
| BCM-DEC-CUS-001 | DOM-DEC-024 deactivation/anonymization; DOM-DEC-044 historical Customer data | Before affected Customer/Sale snapshots |
| BCM-DEC-CUS-002 | DOM-DEC-062 + DB-DEC-008 strong duplicate identifier and normalization | Before any blocking Customer unique constraint |
| BCM-DEC-SAL-001 | DB-DEC-001, DOM-DEC-025/042 Payment cardinality and reconciliation | Before Sale persistence |
| BCM-DEC-SAL-002 | DB-DEC-005 + DOM-DEC-014 rate convention, precision, and rounding | Before monetary calculation |
| BCM-DEC-SAL-003 | DOM-DEC-030/043/045 discounts, empty Sale, zero-price behavior as exposed | Before affected Draft commands |
| BCM-DEC-SAL-004 | DOM-DEC-056/054 + DB-DEC-009 Sale Correction deltas, dependencies, reporting periods and manual authority | Before BCM-SAL-010 |
| BCM-DEC-RES-001 | DOM-DEC-058/038 deposit execution, post-expiry effects and modification; refundability/alert are confirmed | Before implementing affected automatic/financial behavior |
| BCM-DEC-RES-002 | DOM-DEC-053 post-cancellation Reservation result | Before cancelling a Sale originated in Reservation |
| BCM-DEC-TRD-001 | Verify the resolved DB-DEC-004 + DOM-DEC-041 rule: received Equipment starts `Available`; no remaining business choice | Before Trade-In schema/confirmation |
| BCM-DEC-TRD-002 | DOM-DEC-042/049 overpayment and later cost; DOM-DEC-012 multiplicity is confirmed | Before affected Trade-In behavior |
| BCM-DEC-AUD-001 | DOM-DEC-033/054 audit detail and manual-resolution authority | Before manual-resolution workflow or expanded Audit UI |
| BCM-DEC-PRC-001 | DOM-DEC-051 suggested-rate convention/permission; text Price List format is confirmed | Before affected setting/export beyond text |
| BCM-DEC-DASH-001 | DB-DEC-005/009 and DOM-DEC-066 attribution/conversion details; DOM-DEC-032 baseline is confirmed | Before Dashboard implementation |
| BCM-DEC-EXP-001 | DOM-DEC-066 + DB-DEC-012 Expense taxonomy and investment treatment | Before Expense persistence |
| BCM-DEC-WAR-001 | DOM-DEC-064 + DB-DEC-010 Warranty defaults, coverage and V1 lifecycle | Before Warranty persistence |
| BCM-DEC-FIN-001 | DOM-DEC-063 + DB-DEC-001/011 Financing depth and Payment reconciliation | Before Financing/Sales persistence affected by it |
| BCM-DEC-OPS-001 | Current providers, region, plans, PITR, storage recovery, pool, metrics, uptime | Before staging provisioning |

### Current database decision status

- `DB-DEC-001` Pending: Payment/Financing model; blocked by BCM-DEC-SAL-001 and BCM-DEC-FIN-001.
- `DB-DEC-002` Pending: tenant SKU uniqueness; blocked by BCM-DEC-INV-002.
- `DB-DEC-003` Pending: Accessory lifecycle; blocked by BCM-DEC-INV-002.
- `DB-DEC-004` Resolved by BCM-012A: received Trade-In Equipment starts `Available`; Sale 1:N Trade-In is confirmed.
- `DB-DEC-005` Pending: exchange rate and rounding; blocked by BCM-DEC-SAL-002.
- `DB-DEC-006` Resolved: initial RLS/bootstrap administration strategy; implemented and verified in Phase 2/4.
- `DB-DEC-007` Pending: reusable tracking/IMEI policy location; blocked by BCM-DEC-CAT-001.
- `DB-DEC-008` Pending: strong Customer duplicate criterion; blocked by BCM-DEC-CUS-002.
- `DB-DEC-009` Pending: Sale Correction persistence/deltas/reporting; blocked by BCM-DEC-SAL-004.
- `DB-DEC-010` Pending: Warranty defaults/lifecycle; blocked by BCM-DEC-WAR-001.
- `DB-DEC-011` Pending: Financing representation; blocked by BCM-DEC-FIN-001.
- `DB-DEC-012` Pending: Expense taxonomy/investment treatment; blocked by BCM-DEC-EXP-001.

No unresolved decision may be replaced by a task-level default.

## 38. Security deferred decisions and triggers

| Capability | V1 position | Revisit trigger |
|---|---|---|
| MFA | Deferred; password/session controls remain mandatory | First production security review, incident, client requirement, or Owner/Admin risk warrants WebAuthn/TOTP |
| Separate general email verification | Deferred; invitation acceptance verifies managed provisioning | Self-signup or sensitive email-dependent flow |
| Platform Admin | No universal super-admin | Operational multi-tenant support need; requires separate granular JIT/time-bound audited capability |
| Distributed rate limiting | Local adapter plus persistent identity state initially | More than one API replica or sustained abuse requires shared/provider-backed implementation review |
| SSO/SAML | Deferred | Contractual enterprise identity requirement |
| Advanced upload scanning/CDR | Deferred for simple photos | File types, threat model, regulation, or incident changes |

These are not V1 core tasks unless a trigger fires and the required Security/Architecture/Deployment reviews approve them.

## 39. Parallelization rules

Safe after RG-01:

- DS-001 can progress beside DB/Identity because it owns frontend presentation foundations only.
- DB foundation remains sequential inside its migrations and conventions.

Safe after RG-04:

- Customer and Supplier slices can run in separate branches after independent contracts are fixed.
- Feature UI primitives may progress beside backend work only against an approved contract.
- Documentation/runbook preparation can progress beside non-conflicting implementation.

Unsafe to parallelize:

- competing definitions of the same API/schema/domain contract;
- Identity and tenant context before session semantics are stable;
- RLS patterns and commercial tables before RG-04;
- Accessory locking and Sale confirmation before RG-07;
- confirmation, cancellation, Reservation conversion, and Trade-In atomicity without their predecessors;
- migrations touching the same tables;
- provider provisioning before current capability verification.

Parallel branches never merge conflicting assumptions to “resolve later.”

## 40. Definition of Ready

A task may enter `In Progress` only when:

- objective and explicit non-goals are known;
- dependencies and prior Review Gates are Completed;
- no blocking decision remains unresolved;
- applicable sources and invariants are named;
- acceptance criteria are observable;
- expected tests and commands are known;
- risk and required reviews are labeled;
- database/security/tenant/operations impacts are understood;
- task size is independently reviewable;
- authority exists for dependencies, external actions, or destructive operations.

If any item fails, keep the task Pending or Blocked.

## 41. Definition of Done

A task is Completed only when:

- approved scope is implemented and out-of-scope work was not started;
- acceptance criteria are met;
- relevant tests pass at real boundaries;
- applicable lint, typecheck, build, migration, integration, security, E2E, and performance checks pass;
- tenant, authorization, safe error, and history implications are verified;
- migration SQL, locks, RLS, constraints, and recovery are reviewed when applicable;
- observability and audit behavior are adequate and safe;
- final diff is reviewed and contains no unrelated change, secret, debug artifact, or permanent mock;
- documentation changes only when a source decision or contract changed;
- required Review Gate explicitly passes;
- completion report lists files, commands/results, risks, decisions, and remaining work;
- Codex stops without beginning the next task.

## 42. Migration task pattern

Every migration task states:

1. schema contract and source decision;
2. generated/reviewed SQL;
3. lock/rewrite and data-volume impact;
4. tenant-aware keys, RLS, grants, and runtime/migration roles;
5. empty-to-latest and representative-upgrade tests;
6. application compatibility and expand/migrate/switch/contract order;
7. rollback limitations and forward-fix/restore plan;
8. evidence required at its Review Gate.

Never edit an applied migration or hide schema change inside unrelated UI work.

## 43. Frontend/API contract discipline

Critical features define request, response, decimal encoding, permission, idempotency, and error contracts before UI implementation.
This is proportional contract-first design, not a separate governance program.
Frontend uses real API contracts once a slice exists.
MSW may support UI tests only after the contract is approved and must not become a production fallback.
Do not build all frontend before backend or all backend before user-visible vertical validation.

## 44. Refactoring and technical debt

Do not schedule recurring “big refactor” phases.
Propose bounded refactoring at Review Gates only when a pattern is proven, duplication is real, or measurable architecture pressure exists.
Use `Technical Debt Candidate` for a known imperfection only when its impact, trigger, and non-blocking status are documented.
Not every aesthetic imperfection becomes a roadmap task.
Do not create `v2`, `new`, or parallel implementations to defer cleanup.

## 45. Git, branches, and PRs

Prefer one coherent task per branch, or a tightly related set only when explicitly approved.
Readable example: `feat/bcm-fnd-001-monorepo-bootstrap`.
One task may use one or a few logical commits; never bundle unrelated tasks.
Do not rewrite shared history or disturb pre-existing work.

Future PR summaries should contain:

- Task ID;
- What changed;
- Why now;
- Risk and review flags;
- Tests and exact results;
- Migrations/data effects;
- Security/tenant effects;
- screenshots for UI when useful;
- follow-ups and decision gates.

No GitHub PR template is created by BCM-012.

## 46. Codex prompt discipline

Future prompts cite the task ID, require `AGENTS.md`, name task-specific sources, scope, acceptance, tests, exclusions, and the stop condition.
They do not repeat every permanent engineering rule or use another massive planning prompt.

Preferred form:

```text
Implement BCM-FND-001.

Read AGENTS.md and the sources named by the task.

Objective:
...

Scope:
...

Acceptance:
...

Tests:
...

Do not:
...

Stop after completion. Do not start the next roadmap task.
```

## 47. Phase completion review

At the end of every major phase:

1. review architecture pressure and boundary quality;
2. review domain, security, and tenant compliance;
3. review migration/data safety where relevant;
4. review test reliability and CI duration;
5. review observability and performance evidence;
6. record resolved/new decision gates and technical debt candidates;
7. refine only the next planning horizon;
8. update statuses and stop for explicit approval.

## 48. Design-phase exit criteria

- The implementation sequence and dependency graph exist.
- The first task and first ten tasks are identified.
- Twenty-four near-term tasks have bounded outcomes.
- Review Gates protect repository, database, Identity, tenant isolation, inventory, Sales, restore, and production.
- Database and business decisions are mapped to deadlines without being resolved here.
- Security-deferred capabilities have explicit triggers.
- Basic CI, tests, Design System, and observability occur early.
- Staging, load, restore, readiness, and production remain sequential.
- No Critical design blocker prevents BCM-FND-001.
- No code, dependency, application, schema, migration, CI, or provider change was performed by BCM-012.

**Design & Engineering Planning Phase Complete**

Further implementation requires a separately authorized task. `BCM-TST-001` is Completed.
