# Architecture Decision Records

**Estado:** Active  
**Fase inicial:** BCM-003 — Architecture Definition

Los ADRs registran decisiones arquitectónicas importantes de BCM SOFT. Una decisión aceptada no se edita para ocultar cambios posteriores: debe ser reemplazada por un ADR nuevo que explique el contexto, la nueva decisión y sus consecuencias.

## Estados

- `Proposed`: pendiente de aprobación.
- `Accepted`: decisión vigente.
- `Superseded`: reemplazada por otro ADR.
- `Rejected`: evaluada y descartada.

## Índice

| ADR | Decisión | Status |
|---|---|---|
| [ADR-001](ADR-001-modular-monolith.md) | Modular Monolith | Accepted |
| [ADR-002](ADR-002-monorepo.md) | Monorepo | Accepted |
| [ADR-003](ADR-003-postgresql.md) | PostgreSQL | Accepted |
| [ADR-004](ADR-004-shared-database-multitenancy.md) | Shared Database Multi-Tenancy | Accepted |
| [ADR-005](ADR-005-rest-api.md) | REST API | Accepted |
| [ADR-006](ADR-006-server-side-sessions.md) | Server-Side Sessions | Accepted |
| [ADR-007](ADR-007-prisma.md) | Prisma ORM | Accepted |

## Formato mínimo

Cada ADR contiene Context, Decision, Alternatives Considered, Consequences y Status.
