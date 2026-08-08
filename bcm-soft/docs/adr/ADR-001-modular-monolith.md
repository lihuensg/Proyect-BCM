# ADR-001 — Modular Monolith

**Date:** 2026-08-08  
**Status:** Accepted

## Context

BCM SOFT comienza con BCM como primer cliente, aproximadamente 10–40 usuarios concurrentes y un dominio con operaciones fuertemente relacionadas: Sale, Inventory, Reservation y Trade-In deben conservar atomicidad, trazabilidad y consistencia.

El equipo y costo operativo iniciales serán reducidos. La arquitectura debe crecer a cientos de usuarios sin distribuir prematuramente los flujos comerciales.

## Decision

Construir la API como un **Modular Monolith**:

- un único artefacto desplegable de backend;
- módulos con ownership, interfaces y dependencias explícitas;
- una base PostgreSQL compartida;
- transacciones locales para workflows cruzados;
- reglas estáticas y tests que impidan dependencias circulares o acceso a internals.

La extracción futura de un módulo requiere evidencia de escalado, aislamiento operativo, ownership o deploy independiente, y un ADR nuevo.

## Alternatives Considered

### Microservices

Descartados para V1. Agregarían coordinación distribuida, compatibilidad de contratos, observabilidad entre procesos, fallos parciales y mayor costo sin un workload independiente demostrado.

### Monolito sin límites

Descartado. Simplifica inicialmente, pero permite acoplamiento y ownership ambiguo que dificultarían la evolución.

## Consequences

### Positive

- Transacciones simples para invariantes críticas.
- Deployment, debugging y operación de bajo costo.
- Cambios verticales rápidos con límites internos.
- Escalado horizontal del proceso API cuando sea necesario.

### Negative

- Un deploy del backend afecta a todos los módulos.
- La disciplina modular debe verificarse continuamente.
- Un módulo ruidoso comparte recursos con los demás hasta que exista una extracción justificada.

### Neutral

Modular Monolith no impide microservicios futuros; exige que la distribución responda a evidencia.
