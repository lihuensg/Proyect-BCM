# ADR-008 — Authentication: Auth0 and Server-Side Sessions

**Date:** 2026-10-05  
**Status:** Accepted  
**Supersedes:** [ADR-006](ADR-006-server-side-sessions.md)

## Context

BCM SOFT V1 es una aplicación Web administrativa. Requiere login, logout, expiración, revocación, múltiples dispositivos y recuperación de acceso. No hay registro abierto: un Owner o Admin da de alta a cada User, y la primera Organization con su Owner se crea una única vez al configurar la instancia. Custodiar contraseñas, recuperación y protección contra fuerza bruta es una capacidad especializada que no aporta valor de negocio propio.

## Decision

1. **Auth0 verifica credenciales.** El API ejecuta OIDC Authorization Code con PKCE S256 como cliente confidencial (Auth0 *Regular Web Application*). El navegador solo navega: `GET /api/auth/auth0/start` redirige a Auth0 y `GET /api/auth/auth0/callback` recibe el code, lo canjea por back channel con el client secret y verifica el ID token (firma RS256 por JWKS, `iss`, `aud`, `exp`, `nonce`, `azp` con varias audiencias). Ningún token de Auth0 llega a JavaScript. BCM no almacena contraseñas.
2. **BCM emite sesiones server-side.** Tras verificar la identidad, el API crea una sesión con identificador opaco aleatorio en cookie `HttpOnly`, `Secure` y `SameSite=Lax`; PostgreSQL guarda solo su hash. Requests que modifican estado tienen protección CSRF; logout y eventos de seguridad revocan la sesión; hay expiración por inactividad y absoluta y revocación por dispositivo.
3. **Transacción OIDC en cookie firmada.** `state`, `nonce` y `code_verifier` viajan en una cookie HttpOnly, SameSite=Lax, de 10 minutos y un solo uso, firmada con HMAC con una clave derivada por HKDF de `CSRF_HMAC_KEY` con separación de dominio. El `state` del callback se compara en tiempo constante y es la defensa CSRF del callback.
4. **Vínculo por subject, nunca por email al ingresar.** `user_external_identities` vincula cada User con un único `(provider, subject)`. El login resuelve el User solo por subject; un subject desconocido se rechaza (`access_denied`) aunque el email coincida con un User.
5. **Alta administrativa vía Management API.** Dar de alta un User (`memberships.manage`, con las reglas de rol de DOMAIN.md §3.4) crea la cuenta en la *database connection* de Auth0 mediante una aplicación Machine-to-Machine limitada a `create:users` y `read:users`, guarda vínculo, Membership y Audit Record en una transacción y luego pide a Auth0 el email para elegir contraseña. La llamada a Auth0 ocurre fuera de toda transacción y la operación se re-autoriza antes de escribir.
6. **Configuración inicial única.** Mientras no existe ninguna Organization, la Web muestra un asistente que crea la primera Organization y su Owner con el mismo mecanismo de alta. Está protegido por un `SETUP_TOKEN` del servidor; sin él, la configuración está deshabilitada.
7. **Renovación y logout.** Una sesión con autorización desactualizada se renueva iniciando sesión de nuevo. Logout revoca la sesión BCM y luego pasa por el logout de Auth0 para cerrar también su sesión SSO.

## Alternatives Considered

### Contraseñas propias (Argon2id) y recuperación por email

Descartado: obliga a custodiar hashes, calibrar parámetros, mantener blocklists, rate limits persistentes por identidad, tokens de recuperación y envío de emails, sin ventaja de negocio frente a un proveedor especializado.

### SDK de Auth0 en la SPA (`@auth0/auth0-react`)

Descartado: deja ID/access tokens en JavaScript, expuestos ante XSS, y obliga al API a aceptar tokens enviados por el navegador, con su riesgo de replay.

### JWT o access/refresh tokens en lugar de sesiones

Descartado para V1: revocación más compleja, mayor exposición ante XSS y rotación con reuse detection sin una necesidad stateless o de múltiples clientes.

### Vincular por email verificado en el primer login

Descartado: la semántica de `email_verified` varía entre conexiones (social, enterprise) y convertiría cualquier conexión habilitada en Auth0 en una vía de toma de cuentas. El alta administrativa ya conoce el subject.

## Consequences

### Positive

- Contraseñas, recuperación, protección contra fuerza bruta y MFA futura quedan en un proveedor especializado.
- Revocación y logout simples con credencial opaca fuera del alcance de JavaScript.
- Sin registro abierto: solo ingresa quien tiene un vínculo creado por un Owner/Admin o por la configuración inicial.

### Negative

- Dependencia de la disponibilidad de Auth0 para nuevos logins y altas; las sesiones existentes siguen funcionando.
- Secretos server-side (client secret, secreto M2M, `SETUP_TOKEN`) con su rotación.
- Requiere session store y protección CSRF, y cada request autenticada valida estado de sesión.
- Una cuenta creada en Auth0 cuya alta en BCM falla luego queda en Auth0; un reintento la reutiliza.

### Neutral

PostgreSQL es suficiente como session store; Redis solo se evaluará con evidencia.

## References

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [RFC 7636 — PKCE](https://www.rfc-editor.org/rfc/rfc7636)
- [Auth0 — Authorization Code Flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow)
- [NestJS CSRF protection](https://docs.nestjs.com/security/csrf)
