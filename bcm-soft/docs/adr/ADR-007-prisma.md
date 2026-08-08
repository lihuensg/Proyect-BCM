# ADR-007 — Prisma ORM

**Date:** 2026-08-08  
**Status:** Accepted

## Context

El backend Node.js/TypeScript necesita acceso type-safe a PostgreSQL, migrations revisables, transacciones, buen onboarding y una vía controlada para queries avanzadas. El Domain no debe acoplarse al mecanismo de persistencia.

## Decision

Adoptar **Prisma ORM** como database access layer V1.

- Prisma se encapsula en infrastructure adapters/repositories por módulo.
- Domain y Application no exponen tipos generados.
- Controllers no acceden directamente al client.
- Transacciones cubren casos de uso comerciales completos.
- SQL parametrizado/TypedSQL puede utilizarse como excepción revisada para capacidades no expresables adecuadamente.
- APIs raw inseguras y SQL construido con strings están prohibidos.

## Alternatives Considered

### Drizzle ORM

Ofrece tipado cercano a SQL, control y migrations flexibles. Es una alternativa sólida, pero deja más convenciones de mapping y repositorios a definir para el equipo inicial.

### TypeORM

Tiene amplio soporte y patrones Data Mapper/Active Record. Se descarta por mayor runtime magic y riesgo de acoplar entidades a decorators de persistencia.

### SQL directo controlado

Brinda máximo control, pero aumenta mapping y disciplina manual para la mayoría de operaciones V1.

## Consequences

### Positive

- Type safety y navegación clara del modelo de persistencia.
- Transacciones y migrations integradas.
- Productividad y contexto explícito para desarrollo asistido por Codex.

### Negative

- Queries PostgreSQL avanzadas pueden requerir escape hatch.
- La generación del client agrega un paso al toolchain.
- El equipo debe evitar que tipos Prisma atraviesen límites del módulo.

### Neutral

La elección no define el schema, que pertenece a BCM-004.

## References

- [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [TypeORM transactions](https://typeorm.io/docs/transactions/)
