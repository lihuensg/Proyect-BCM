# ADR-002 — Monorepo

**Date:** 2026-08-08  
**Status:** Accepted

## Context

BCM SOFT tiene una Web, una API, documentación, infraestructura y futuros paquetes internos que evolucionarán juntos. Las features V1 cruzarán frontend, backend, tests y documentación con frecuencia.

## Decision

Mantener Web, API, paquetes intencionales, documentación, infraestructura y scripts en un **monorepo**.

El monorepo no permite imports arbitrarios:

- cada app conserva dependencias y runtime propios;
- backend Domain no se comparte con frontend;
- packages requieren ownership y propósito explícito;
- reglas de CI validan dependencias y alcance de cambios;
- contratos compartidos no trasladan autoridad de negocio a la Web.

## Alternatives Considered

### Repositorios separados

Ofrecen ciclos y permisos independientes, pero en la etapa actual aumentarían coordinación de contratos, tooling duplicado y cambios cruzados.

### Repositorio único sin workspaces ni límites

Descartado porque no establece dependencias explícitas ni builds selectivos.

## Consequences

### Positive

- Un cambio vertical es revisable en una unidad.
- Configuración y CI consistentes.
- ADRs y documentación permanecen junto al producto.
- Mejor contexto para desarrollo asistido por Codex.

### Negative

- CI y ownership requieren disciplina a medida que crece el repositorio.
- Shared code puede convertirse en acoplamiento si no se controla.

### Neutral

Monorepo no implica un único deployment; Web y API se despliegan separadamente.
