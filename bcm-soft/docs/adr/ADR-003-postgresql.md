# ADR-003 — PostgreSQL

**Date:** 2026-08-08  
**Status:** Accepted

## Context

El dominio exige transacciones, consistencia concurrente, relaciones, constraints, historial económico, reporting y aislamiento por Organization. Las ventas afectan múltiples elementos de inventario y no pueden quedar parcialmente aplicadas.

## Decision

Usar **PostgreSQL** como system of record operacional de BCM SOFT V1.

PostgreSQL almacenará estado comercial, historial, relaciones, sesiones y metadata de archivos. Los binarios permanecerán en object storage.

Database Design definirá schema, constraints, índices, locks, isolation levels y evaluación de Row-Level Security.

## Alternatives Considered

### Base documental NoSQL

Descartada como store principal. El dominio relacional y transaccional exigiría reconstruir integridad y joins críticos en aplicación.

### Múltiples bases especializadas

Descartadas para V1 por costo operativo, sincronización y ausencia de una necesidad demostrada.

### Base embebida

Útil para escenarios locales simples, pero no representa la concurrencia, constraints ni operación productiva requerida.

## Consequences

### Positive

- Transacciones ACID y constraints para invariantes.
- Buen soporte de concurrencia, queries complejas y reporting.
- Row-Level Security disponible como defensa adicional a evaluar.
- Ecosistema maduro de backups, pooling y observabilidad.

### Negative

- Requiere migrations cuidadosas y administración de conexiones.
- Escalado y tuning demandan observación de queries reales.

### Neutral

Adoptar PostgreSQL no autoriza diseñar el schema antes de BCM-004.

## References

- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
