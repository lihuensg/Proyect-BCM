# ADR-005 — REST API

**Date:** 2026-08-08  
**Status:** Accepted

## Context

La Web administrativa necesita operaciones predecibles, búsqueda, filtros, paginación, errores uniformes e integración simple con autenticación por cookie. No existe un requisito de clientes públicos heterogéneos ni consultas arbitrarias.

## Decision

Exponer la API V1 como **REST JSON sobre HTTPS**.

- semántica HTTP consistente;
- errores con código estable y correlation ID;
- server-side pagination/filtering/search/sorting;
- idempotencia en comandos sensibles;
- versionado explícito cuando exista un cambio incompatible;
- documentación de contrato sin definir endpoints en este ADR.

## Alternatives Considered

### GraphQL

La flexibilidad de selección no compensa la complejidad adicional de autorización, cache, query limits y observabilidad para V1.

### RPC

Puede expresar comandos claramente, pero aporta menor alineación con tooling HTTP convencional y no resuelve una necesidad actual.

### Acceso directo del frontend a la base

Rechazado. Evitaría la capa autoritativa de autorización, tenant context y dominio.

## Consequences

### Positive

- Debugging y observabilidad directos.
- Amplio tooling y contratos conocidos.
- Despliegue Web/API independiente.

### Negative

- Requiere disciplina para recursos, acciones de dominio y evolución.
- Puede necesitar endpoints de lectura específicos para evitar over-fetching.

### Neutral

REST no impide adapters o APIs diferentes en una futura necesidad demostrada.
