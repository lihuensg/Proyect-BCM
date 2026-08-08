# ADR-006 — Server-Side Sessions

**Date:** 2026-08-08  
**Status:** Accepted

## Context

BCM SOFT V1 es una aplicación Web administrativa. Requiere logout, expiración, revocación, múltiples dispositivos y recuperación de acceso sin introducir complejidad de tokens distribuida.

## Decision

Usar **sesiones server-side** con un identificador opaco aleatorio en cookie `HttpOnly`, `Secure` y `SameSite` apropiada.

- Las sesiones se almacenan inicialmente en PostgreSQL.
- Requests que modifican estado tienen protección CSRF.
- Logout y eventos de seguridad revocan la sesión.
- Se soportan expiración, rotación y revocación por dispositivo.
- La Web nunca persiste un bearer token de larga vida en storage accesible a JavaScript.
- Un proveedor externo puede incorporarse detrás de un adapter futuro.

## Alternatives Considered

### JWT persistido en browser storage

Descartado para V1 por exposición ante XSS, revocación más compleja y ausencia de una necesidad stateless real.

### Access y refresh tokens

Útiles para múltiples tipos de cliente, pero agregan rotación, reuse detection y más estados de seguridad.

### Identity provider externo obligatorio

No existe requisito actual de SSO que justifique costo y dependencia. Se mantiene como extensión futura.

## Consequences

### Positive

- Revocación y logout simples.
- Credencial opaca fuera del alcance normal de JavaScript.
- Modelo adecuado para una SPA first-party.

### Negative

- Requiere session store y protección CSRF.
- Cada request autenticada consulta o valida estado de sesión.

### Neutral

PostgreSQL es suficiente inicialmente; Redis solo se evaluará con evidencia.

## References

- [NestJS CSRF protection](https://docs.nestjs.com/security/csrf)
