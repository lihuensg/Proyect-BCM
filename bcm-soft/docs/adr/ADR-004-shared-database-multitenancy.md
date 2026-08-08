# ADR-004 — Shared Database Multi-Tenancy

**Date:** 2026-08-08  
**Status:** Accepted

## Context

BCM será inicialmente la única Organization, pero BCM SOFT debe permitir negocios independientes. La estrategia necesita aislamiento seguro, bajo costo, migrations simples, desarrollo local razonable y crecimiento sin crear infraestructura por tenant.

## Decision

Usar **una base PostgreSQL y un schema compartidos**, con identificación obligatoria de Organization en toda información tenant-owned.

- La sesión autenticada y Membership resuelven Current Organization Context.
- La API no confía en un Organization ID enviado por la Web como autorización.
- Repositories/adapters aplican scoping por Organization.
- Constraints, policies y tests agregan defensa en profundidad.
- Row-Level Security se evalúa concretamente en BCM-004/BCM-005.

## Alternatives Considered

### Database por tenant

Aislamiento fuerte, pero multiplica conexiones, backups, migrations y costo. No se justifica para la escala prevista.

### Schema por tenant

Separación lógica visible, pero complica migrations, tooling y operación a medida que crecen los negocios.

### Aplicación single-tenant sin concepto de Organization

Descartada porque fijaría BCM como supuesto estructural y exigiría una reescritura posterior.

## Consequences

### Positive

- Un pipeline de schema y migrations.
- Bajo costo operacional.
- Desarrollo y tests sencillos.
- Alta densidad para Organizations pequeñas.

### Negative

- Toda consulta tenant-owned debe aplicar contexto correctamente.
- Un error de scoping puede tener impacto crítico.
- Backups/restores por Organization son más complejos que con bases separadas.

### Neutral

Tenant isolation sigue siendo responsabilidad de múltiples capas; ninguna barrera aislada es suficiente.
