# BCM SOFT — Engineering Agent Contract

## 1. Purpose

This file is the operational contract for every human or AI agent changing BCM SOFT.
It summarizes approved rules; it never replaces their source documents.

## 2. Authority and conflicts

Use this precedence order:

1. The current explicit user or task instruction.
2. `docs/DOMAIN.md` for business rules.
3. Accepted ADRs in `docs/adr/`.
4. `docs/ARCHITECTURE.md`.
5. `docs/DATABASE.md`.
6. `docs/SECURITY.md`.
7. The applicable specialized standard.
8. This `AGENTS.md` summary.
9. Existing implementation details.

Never use a lower source to override a higher one.
Existing code is not proof that a decision is correct.
If applicable sources conflict, stop and report both passages and their impact.
Do not choose silently or create a compatibility workaround.
An explicit task may narrow scope but does not silently repeal documented invariants.
Changing an Accepted decision requires its source update and required review.

## 3. Source-of-truth map

- Product purpose and V1 scope: `docs/PRODUCT.md`.
- Domain language, rules, flows, invariants, and pending decisions: `docs/DOMAIN.md`.
- System shape, boundaries, baseline, and quality attributes: `docs/ARCHITECTURE.md`.
- Durable model, constraints, RLS, migrations, and concurrency: `docs/DATABASE.md`.
- Threats, authentication, authorization, files, secrets, and audit: `docs/SECURITY.md`.
- Backend implementation: `docs/BACKEND_STANDARDS.md`.
- Frontend implementation: `docs/FRONTEND_STANDARDS.md`.
- Test levels, tools, and gates: `docs/TESTING.md`.
- Logs, errors, metrics, health, and alerting: `docs/OBSERVABILITY.md`.
- Environments, CI/CD, release, recovery, and production: `docs/DEPLOYMENT.md`.
- Architecture decisions: `docs/adr/`.
- Delivery sequence and status: `roadmap/ROADMAP.md`.

Read relevant sources before changing anything.
Domain work requires `DOMAIN.md` and every affected specialist document.
Architecture work requires `ARCHITECTURE.md` and all Accepted ADRs.
Database work requires `DOMAIN.md`, `DATABASE.md`, `SECURITY.md`, and ADR-003/004/007.
Auth, authorization, tenancy, files, and sensitive data require `SECURITY.md` in full.
Backend work requires `BACKEND_STANDARDS.md` and affected domain/data/security rules.
Frontend work requires `FRONTEND_STANDARDS.md`, the API contract, and affected security rules.
Testing work requires `TESTING.md` and the contract under test.
Operations work requires `OBSERVABILITY.md` and `DEPLOYMENT.md`.
Deployment or migration work also requires `DATABASE.md` and `SECURITY.md`.

## 4. Product and tenant model

BCM SOFT is SaaS for cellular phone, technology, and accessory retailers.
BCM is the first Organization, not a special product branch.
Every commercial concept belongs functionally to one Organization.
Data and history from different Organizations must never mix.
Build tenant-aware reusable behavior from the first implementation.

Never add:

- `if BCM` or client-name conditionals;
- hard-coded tenant IDs, roles, catalogs, prices, or limits;
- client-specific forks or parallel paths;
- schema, tables, or database per tenant in V1;
- tenant identity accepted from an untrusted request as authority.

## 5. Architecture baseline

The system is a modular monolith in a monorepo.
Web uses React, TypeScript, and Vite.
API uses NestJS with strict TypeScript.
PostgreSQL is the system of record.
Prisma is the encapsulated ORM and migration tool.
The application interface is REST under `/api`.
Authentication uses server-side sessions.
Multitenancy uses a shared database and schema.
Authorization uses centralized code-defined RBAC based on active Membership.
Tenant-owned files use private object storage.
The workspace uses pnpm workspaces with one root lockfile.
CI/CD uses GitHub Actions.
Production uses managed infrastructure chosen by documented capability review.
Module boundaries reflect business capabilities.
Modules communicate through explicit contracts, never direct persistence access.

## 6. V1 non-goals

Do not introduce without a new approved decision:

- microservices or distributed transactions;
- Kubernetes;
- Kafka, RabbitMQ, or another broker;
- event sourcing or full CQRS;
- Elasticsearch;
- Redis, distributed cache, or queue workers;
- GraphQL;
- database-per-tenant or schema-per-tenant;
- custom authentication or ORM;
- a generic workflow engine;
- active multi-cloud architecture;
- abstractions for hypothetical providers or clients.

Redis or workers require measured triggers and all relevant specialist reviews.

## 7. Engineering principles

Prefer clarity, simplicity, explicit behavior, and small cohesive changes.
The backend is authoritative for rules, authorization, and critical calculations.
PostgreSQL protects durable invariants where reliable.
Deny by default and grant minimum capability.
Tenant isolation is an invariant, not a query convention.
Historical records remain trustworthy and explainable.
Measure before optimizing or scaling.
Fix root causes instead of masking symptoms.
Do not hide failures or invent dangerous fallbacks.
Prefer documented, proven technology over novelty.

## 8. Required workflow

Every task follows `ANALYZE → PROPOSE → IMPLEMENT → TEST → REVIEW → DOCUMENT`.

### ANALYZE

- Restate the outcome and non-goals.
- Inspect repository, diff, instructions, and relevant sources.
- Trace entry points, callers, data, boundaries, tests, and operational effects.
- Identify domain, tenant, security, money, concurrency, and migration risks.
- Search for reusable behavior before creating anything.
- Classify risk and expose unresolved decisions.

### PROPOSE

- Explain the smallest coherent change.
- Name affected files and boundaries.
- Cite the source of each non-obvious rule.
- State transaction, auth, tenant, test, rollout, and rollback needs.
- Raise review flags before implementation.
- Stop if a missing decision materially changes the outcome.

### IMPLEMENT

- Stay within approved scope.
- Keep changes cohesive, typed, and reviewable.
- Reuse compliant established patterns.
- Preserve module and layer boundaries.
- Add no dependency, provider, service, or abstraction without authority.
- Never disable a policy, constraint, guard, test, or check.

### TEST

- Verify the changed contract at useful levels and boundaries.
- Cover success, failure, authorization, isolation, and edge cases as applicable.
- Use real PostgreSQL for persistence semantics.
- Exercise actual concurrency for concurrency claims.
- Record commands, results, and untested risks.

### REVIEW

- Inspect the final diff, migration SQL, and lockfile changes.
- Check scope, sources, security, isolation, history, errors, and observability.
- Find duplicate paths, accidental APIs, secret exposure, and unrelated edits.
- Confirm applicable format, type, lint, test, build, and migration gates.

### DOCUMENT

- Update docs only for changed decisions, contracts, invariants, or operations.
- Keep one authority; link instead of copying large rules.
- Report changes, reasons, verification, risks, and pending work.
- Mark roadmap completion only after implementation and review.

## 9. Scope and repository discipline

Implement only requested functionality.
Do not edit unrelated files merely to clean them.
Preserve user changes and dirty worktree content.
Do not create `new`, `v2`, `fixed`, or parallel paths to avoid current code.
Remove obsolete paths only when migration/removal is authorized.
Do not perform drive-by refactors.
Split work that combines unrelated decisions.

Before creating a file, component, helper, service, repository, hook, or schema:

1. Search by concept and behavior.
2. Inspect nearby patterns and public contracts.
3. Confirm one clear owner.
4. Reuse or extend when semantics match.
5. Create only for genuinely distinct behavior.

## 10. Bug diagnosis

Reproduce or gather concrete evidence first.
Trace failing state to its origin.
State the root-cause hypothesis and evidence.
Add a regression test that fails for the real defect, then passes.
Fix the earliest correct boundary.
Do not stack retries, guards, casts, defaults, or duplicate state as workarounds.
If root cause remains uncertain, report it and the next diagnostic step.

## 11. Decisions and flags

Never invent a business rule.
Use `Business Decision Required` when the domain is pending or insufficient.
Include the question, affected flow, safe options, and cost of deferral.

Use these exact flags:

- `Business Decision Required`
- `Architecture Decision Required`
- `Database Review Required`
- `Security Review Required`
- `Backend Review Required`
- `Frontend Review Required`
- `Testing Review Required`
- `Deployment Review Required`

New services, datastores, protocols, runtimes, or ADR reversals require an architecture decision.
Schema, migration, constraint, RLS, lock, retention, or high-volume query changes require database review.
Auth, tenancy, permissions, secrets, uploads, exposure, or trust changes require security review.
Stop rather than guess about money, stock, history, isolation, authorization, or destruction.

## 12. Risk classification

- Low: local, reversible, no durable-data or contract impact.
- Medium: bounded behavior or contract change with straightforward rollback.
- High: money, inventory, permissions, tenants, migration, concurrency, integration, or production.
- Critical: plausible cross-tenant exposure, escalation, irreversible corruption, lost history, broad outage, or secret compromise.

High work needs explicit risk analysis and focused review.
Critical work needs authority, specialist flags, recovery evidence, and second review before production.
Never lower classification to bypass a gate.

## 13. Domain invariants

- Accessory stock never becomes negative.
- One Equipment cannot be sold twice.
- Equipment cannot join incompatible active operations.
- An active reservation makes Equipment unavailable to another customer.
- Conversion cannot leave Equipment both Reserved and Sold.
- A Confirmed Sale is historical and never silently rewritten or deleted.
- Sale cancellation is explicit, attributable, guarded, and idempotent.
- Non-reversible cancellation becomes `Manual Resolution Required`.
- Financial values, prices, costs, and rates remain historical snapshots.
- Trade-In Equipment retains its originating Sale.
- Trade-In value reduction and received Equipment creation stay coherent.
- Every tenant-owned operation stays within one Organization.
- IMEI is unique within an Organization, including relevant history.
- ARS operations preserve the exact positive exchange rate used.
- Equipment sale cost uses its specific historical cost.
- Accessory sale cost snapshots moving weighted average cost at confirmation.
- Inventory changes have explicit cause and traceable origin.

Never weaken an invariant because the current UI prevents the case.

## 14. Money

Never use binary floating point for critical money calculations.
PostgreSQL uses documented `numeric` precision and scale.
The API transports precise decimals as canonical strings.
Frontend code never converts critical decimals to JavaScript `number` authoritatively.
The backend validates and calculates authoritative totals and snapshots.
Rounding, scale, payment cardinality, and rate convention remain pending where documented.
Do not select defaults for pending monetary rules.

## 15. Multitenancy and RLS

Derive current Organization from authenticated session, User, and active Membership.
Revalidate Membership; never trust a browser Organization ID alone.
Scope every tenant-owned read and write.
Use tenant-aware unique constraints and composite references where required.
Verify related records share an Organization.

Layer defenses:

1. Session and active Membership.
2. Central authorization.
3. Repository tenant scope.
4. Tenant-aware constraints.
5. RLS on selected operational tables.
6. Isolation tests and audit evidence.

RLS context is transaction-local through `set_config(..., true)`.
Set and consume it in the same explicit transaction.
Missing or invalid context fails closed.
Runtime DB role never owns tables, bypasses RLS, or has DDL.
Use separate runtime, migration, and controlled admin identities.
Never disable RLS or use session-global tenant state as a shortcut.
Test actual pool configuration for leakage.

## 16. Authentication and authorization

Use opaque high-entropy server sessions in Secure, HttpOnly, host-only cookies.
Store only a hash of the session token in PostgreSQL.
Use SameSite=Lax unless a reviewed deployment change says otherwise.
Never store bearer/session secrets in LocalStorage or SessionStorage.
Logout and revocation invalidate server state.

Use CSRF token validation, Origin/Referer checks, and SameSite defense.
Keep CORS explicit and minimal; never use wildcard credentials.
Validate all untrusted input at its boundary.
Return safe errors without internals or existence leaks.

Centralize code-defined permissions from active Membership.
Deny by default and enforce least privilege.
Do not scatter `role === 'admin'` checks.
Frontend checks are UX only; backend authorization is mandatory.
Critical commands require semantic permission, not generic CRUD access.

Keep secrets out of source, fixtures, logs, browser bundles, and examples.
Use provider secret management and documented rotation.
Treat every `VITE_*` value as public.

## 17. Files and uploads

Files are private and tenant-owned by default.
Authorize tenant and permission before issuing short signed operations.
Use opaque keys; never trust user paths or names.
Validate MIME, size, and content constraints at trusted boundaries.
Align limits across proxy, API, policy, and storage.
Never give permanent storage credentials to the browser.
Never expose tenant objects through public CDN rules.

## 18. Backend boundaries

Use feature modules as ownership boundaries.

- Controller: HTTP parsing, mapping, and guards.
- Application: use-case orchestration, authorization, transaction, and ports.
- Domain: concepts and invariants without framework or Prisma coupling.
- Infrastructure: Prisma repositories and external adapters.

Controllers remain thin.
Domain imports no NestJS, Prisma, HTTP, or provider SDK types.
Prisma stays in persistence infrastructure.
Prisma models do not cross module boundaries.
Do not create universal base repositories or catch-all services.
Cross-module access uses an explicit contract owned by the provider.

## 19. Transactions and idempotency

Use explicit transactions for multi-entity or invariant-changing use cases.
Keep them short and never hold them across network calls.
Acquire locks in stable documented order.
Use correct constraints, conditional writes, row locks, and isolation.
Never rely only on read-then-write for contested inventory.

Protect Sale confirmation, Reservation commands, Trade-In intake, inventory adjustment, and reversal from races.
Concurrency tests issue genuinely overlapping operations.
Do not synchronize with arbitrary sleeps.

Critical retriable commands use persistent idempotency scoped to Organization, actor, command, and key.
Store request fingerprint and durable outcome.
Same key and request returns the same result.
Same key with a different request is rejected.
Process-local maps are not idempotency.

## 20. REST API and errors

Use REST resources and semantic command endpoints under `/api`.
Use camelCase JSON and decimal strings.
Never expose rows, Prisma payloads, stacks, or provider errors directly.
Use stable machine-readable error codes.
Include request ID in safe errors and logs.
Separate validation, auth, forbidden, absent, conflict, and unexpected errors.
Prevent cross-tenant existence leaks.

Lists use bounded server-side pagination, filtering, sorting, and search.
Allowlist filter and sort fields.
Never accept raw columns, SQL, or arbitrary relation expansion.

## 21. Frontend

Organize by feature with `app/`, feature ownership, primitives, and small transverse libraries.
Use React Router Data Mode.
TanStack Query is the only remote-state cache.
Use React Hook Form for non-trivial forms.
Use Zod at frontend boundaries; backend remains authoritative.
Use TanStack Table only for complex tables.
Do not add Redux or Zustand by default.

Use one HTTP client plus feature-specific API functions.
Do not duplicate server state in context or stores.
Make query keys Organization-aware.
Clear sensitive cache on logout and Organization switch.
Distinguish loading, refetch, empty, error, and mutation states.
Avoid blind optimistic updates for critical commands.

Use effects only to synchronize external systems.
Prefer events, derived render state, queries, and router primitives.
Never use mocks or stale fixtures as production failure fallback.

Use mobile-first responsive behavior and WCAG 2.2 AA practices.
Provide keyboard access, visible focus, semantics, labels, contrast, and async feedback.
Do not claim certification without formal audit.

## 22. Shared code and dependencies

Keep `shared`, `common`, and `utils` small and ownership-driven.
Share stable semantics, not coincidental syntax.
Prefer minor duplication over premature coupling.
Apply DRY only after understanding repeated meaning and change reason.
Size code by cohesion, not arbitrary limits.

Before adding a dependency, document:

- concrete requirement;
- why existing/platform code is insufficient;
- maintenance, security, bundle/runtime, and license impact;
- affected boundaries;
- removal cost;
- task authority for lockfile change.

Use domain terminology and clear names.
Comments explain why or constraints, not obvious code.
TODOs need a task/owner and exit condition.
Never leave swallowed errors, unsafe casts, or false-success fallbacks.

## 23. Database and migrations

Change schema only through reviewed migrations.
Never edit an applied migration.
Use a forward fix for released defects.
Review SQL, locks, rewrites, constraints, indexes, and recovery.
Test empty-to-latest and representative upgrades.

Use expand → migrate/backfill → switch → contract for incompatible change.
Delay contract/removal to a later compatible release.
Do not run long backfills inside requests or unplanned blocking migrations.
Do not use blanket soft-delete.
Choose retention, archival, cancellation, or deletion from domain meaning.
Historical Sales, cost, movements, reservations, Trade-Ins, and audit remain explainable.

## 24. Testing

Choose tests by risk and contract, not quota.
Use Vitest for backend and frontend tests.
Use React Testing Library and user-event for UI.
Use MSW at frontend network boundaries.
Use real PostgreSQL isolated per worker and Testcontainers where appropriate.
Never substitute SQLite for PostgreSQL behavior.
Use Playwright for critical E2E journeys.

Test invariants, authorization, tenant isolation, rollback, constraints, RLS, idempotency, and errors at real boundaries.
Concurrency tests run competing operations.
Regression work follows red → green and retains the test.
Avoid implementation-coupled tests and meaningless snapshots.
Coverage is diagnostic, not proof of quality.
Initial load profiles use 10, 20, and 40 concurrent users.
Assess latency, errors, saturation, and database evidence.

## 25. Observability

Emit structured logs through the Pino-based adapter.
Propagate request ID through logs, safe errors, and supported outbound calls.
Use consistent event, severity, module, operation, outcome, and duration fields.
Never log tokens, passwords, CSRF, secrets, signed URLs, sensitive payloads, or excess PII.
Audit events are durable evidence distinct from diagnostic logs.

Use Sentry, provider metrics, external uptime, release markers, and safe health endpoints.
Health reveals no secrets or internals.
OpenTelemetry is deferred but boundaries remain compatible.
Do not self-host Prometheus/Grafana in V1.
Avoid high-cardinality labels such as user, tenant, request, IMEI, or raw URL.
The configurable 250 ms slow-query threshold is diagnostic, not a universal SLO.
Alerts require owner, severity, actionable threshold, and runbook.

## 26. Performance

Measure before optimizing.
Inspect plans, indexes, N+1, pagination, payloads, pool, and bundles.
Fix demonstrated bottlenecks at their source.
Do not preemptively add cache, replicas, denormalization, workers, or search.
Preserve correctness, isolation, and history under load.
Record before/after evidence for material optimization.

## 27. Environments, Git, and deployment

Isolate local, test, staging, and production resources and secrets.
Never use production data or credentials for routine development/tests.
Use Node.js 24 LTS and pnpm workspaces when implementation begins.
Maintain one root `pnpm-lock.yaml`; never mix npm/yarn locks.
CI uses a frozen lockfile.

Use `main` with short-lived PR branches.
Do not rewrite shared history or discard user work.
Do not commit secrets, local artifacts, debug data, or unrelated churn.
GitHub Actions use least privilege.
Untrusted PRs never receive production secrets.

Promote the same verified artifact.
Deploy staging before production.
Production requires manual approval and one deployment at a time.
Use pipeline/provider deployment, never `git pull`.
Use separate runtime and migration DB identities.
Apply compatible migrations before incompatible app behavior.
Stop a failed release; never continue speculatively.

Production requires PITR and quarterly isolated restore tests.
Internal targets are RPO ≤ 15 minutes and RTO ≤ 4 hours when provider plans are chosen.
Rollback restores app artifacts/config, not database history.
High-risk migrations need forward-fix or restore planning.

Never expose debuggers, traces, Prisma Studio, admin consoles, or diagnostics publicly.
Prisma Studio is local/isolated synthetic-data tooling only.
Production access is exceptional, temporary, minimal, and documented.
Manual writes require incident/change authority, recovery preparation, and audit.

## 28. External integrations

Place providers behind narrow adapters owned by consumers.
Use explicit timeouts and bounded retries only when safe.
Use idempotency where supported.
Never hold DB transactions or locks during network I/O.
Validate responses and map failures safely.
Log safe correlation data without credentials.
Do not build a generic provider framework for one integration.

## 29. AI/Codex safeguards

Before implementation, report:

1. `Understanding`: outcome and non-goals.
2. `Sources`: documents, ADRs, and code inspected.
3. `Plan`: smallest change and affected boundaries.
4. `Risks`: classification, invariants, and flags.
5. `Verification`: evidence needed for completion.

For bugs, include reproduction and root-cause evidence.
For architecture, identify current decision, alternatives, consequences, and ADR action.
For database, describe SQL, locks, compatibility, RLS, data impact, and recovery.
For security, describe assets, actors, trust boundaries, controls, and residual risk.
For production, describe environment, identity names, downtime, rollout, recovery, and observation.

Never fabricate commands, results, contents, citations, incidents, or approvals.
Provide concise evidence and rationale, not hidden chain-of-thought.
Do not install, publish, deploy, contact external systems, or destroy without task authority.
Stop at the task boundary even when the next roadmap item is obvious.

Avoid generated-code failure modes:

- invented modules or rules;
- broad scaffolding before a use case;
- duplicate models without mapping ownership;
- `any`, assertions, or casts that hide design errors;
- generic repositories or catch-all services;
- frontend-only security;
- mocked success in production paths;
- disabled validation or tests;
- unrelated rewrites presented as cleanup.

## 30. Completion report

At the end of every task, report:

1. Outcome and completed scope.
2. Files created, modified, deleted, or intentionally untouched.
3. Sources and invariants applied.
4. Test/check commands and results.
5. Data, dependency, API, configuration, and operational changes.
6. Security, tenant, data, and performance implications.
7. Problems, residual risks, pending decisions, and flags.
8. Confirmation that no later roadmap task began.

Never claim completion if required verification did not run or a blocker remains.

## 31. Definition of Done

A change is done only when every applicable item is true:

- Acceptance criteria are met and scope stayed bounded.
- Relevant sources were read and no contradiction was hidden.
- Domain invariants and historical meaning are preserved.
- Tenant scope and authorization are enforced at trusted boundaries.
- Input validation and safe errors exist.
- Money uses precise approved representations.
- Transactions, constraints, concurrency, and idempotency match risk.
- Database behavior has reviewed migration and RLS impact.
- Tests cover the contract and meaningful failure paths.
- Applicable type, lint, unit, integration, E2E, build, and migration checks pass.
- Logs, audit, metrics, errors, and health are safe and adequate.
- Affected UI meets responsive and accessibility expectations.
- Material performance impact is measured.
- Dependencies and lockfile changes are authorized.
- Secrets and sensitive data are absent from diff, logs, artifacts, and output.
- Rollout, rollback, restore, compatibility, and runbooks exist when needed.
- Final diff has no unrelated changes, debug artifacts, or parallel path.
- Documentation updates decisions/contracts without duplicating authority.
- Completion report is accurate and roadmap status justified.

## 32. When uncertain

1. Read the higher-authority source again.
2. Protect correctness, tenant isolation, security, and history first.
3. Prefer the smallest reversible evidence-based change.
4. Raise the exact decision or review flag instead of guessing.
5. Stop before crossing scope or risking data.

Never trade correctness, security, tenant isolation, financial integrity, inventory integrity, or trustworthy history for speed or convenience.
