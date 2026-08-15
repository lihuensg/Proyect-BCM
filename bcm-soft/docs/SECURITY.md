# BCM SOFT — Security Architecture

**Estado:** Completed  
**Fase:** BCM-005 — Security Architecture
**Última revisión:** BCM-012A — Customer Business Decisions Reconciliation

Este documento define la arquitectura y los estándares de seguridad de BCM SOFT antes de implementar controles. Usa OWASP ASVS y OWASP Top 10 como referencias conceptuales, sin declarar cumplimiento formal.

## Resumen de decisiones

| Área | Decisión V1 |
| --- | --- |
| Authentication | sesiones server-side mediante cookie opaca |
| Password hashing | Argon2id con parámetros versionados y calibrados |
| Password baseline | mínimo 15 caracteres, máximo 128; sin reglas arbitrarias de composición ni rotación periódica |
| Session store | PostgreSQL; solo hash del token |
| Cookie | `__Host-` cuando el deployment lo permita; HttpOnly, Secure, SameSite=Lax, Path=/, sin Domain |
| CSRF | token ligado a sesión + Origin/Referer + SameSite; CORS no sustituye el control |
| Authorization | RBAC por Membership, permissions por operación, deny-by-default |
| Tenant context | sesión + User + Membership activa; nunca un Organization ID libre como autoridad |
| RLS | parcial desde V1 en tablas operativas tenant-owned, fail-closed y transaction-local |
| Files | privados, key generada por servidor, acceso autorizado o signed URL breve |
| Rate limiting | local inicialmente y estado persistente para flujos de identidad; adapter escalable, sin Redis obligatorio |
| Email verification | sin flujo separado V1; aceptar invitación demuestra control del email |
| MFA | diferido; prioridad futura Owner/Admin con WebAuthn o TOTP |
| Platform Admin | no existe superusuario universal V1 |
| Secrets | entorno local y secret manager en producción; nunca Git/logs/bundles |

## 1. Security Principles

1. Backend authoritative.
2. Deny by default.
3. Least privilege.
4. Tenant isolation mandatory.
5. Never trust client input.
6. Defense in depth.
7. Secrets never committed.
8. Sensitive actions auditable.
9. Fail securely.
10. Historical commercial data is protected from destructive mutation.
11. Authentication and authorization are separate concerns.
12. Security controls must be testable.
13. Security exists at every feature boundary.
14. Security through obscurity is prohibited.
15. No security decision depends exclusively on frontend behavior.

## 2. Threat Model

### Assets

User accounts, password hashes, sessions, Memberships, Organization data, inventory, Sales, Customers, Suppliers, financial values and snapshots, uploaded files, Audit Records, database credentials, application/deployment secrets and backups.

### Threat actors

- una persona no autenticada o bot automatizado;
- un User autenticado malicioso o con permisos insuficientes;
- un empleado intentando acceder a otra Organization;
- un atacante con credenciales o sesión robadas;
- un atacante externo que explota API, browser, upload o infraestructura;
- una dependencia o pipeline comprometidos;
- un operador interno o error humano con privilegios excesivos.

### Attack surfaces

Login, recovery e invitations; REST API; browser/cookies; organization switching; IDs, filtros, búsquedas y sorting manipulados; file upload/download; PostgreSQL y RLS; object storage; deployment/CI; logs/audit; backups y dependencias.

### Trust boundaries

Browser → API, API → PostgreSQL, API → object storage/email provider, CI → deployment y operator → production. Todo cruce valida identidad, autorización, formato, scope y mínima exposición.

## 3. Risk Register

| ID | Threat | Likelihood | Impact | Risk | Mitigation |
| --- | --- | --- | --- | --- | --- |
| SEC-RISK-001 | cross-tenant data leakage | Medium | Critical | Critical | tenant context validado, scoped repositories, FKs, RLS, tests cruzados |
| SEC-RISK-002 | broken access control / IDOR | High | Critical | Critical | permission + ownership por recurso; deny-by-default |
| SEC-RISK-003 | privilege escalation | Medium | Critical | Critical | allowlist de campos, role changes restringidos y auditados |
| SEC-RISK-004 | incorrect/stale RLS context | Medium | Critical | Critical | context transaction-local, runtime role restringido, fail-closed y tests |
| SEC-RISK-005 | race condition altera autorización, stock o ventas | Medium | Critical | Critical | locks, constraints, idempotency y autorización dentro de transaction |
| SEC-RISK-006 | credential stuffing / brute force | High | High | High | rate limits multidimensionales, delay, password blocklist y monitoreo |
| SEC-RISK-007 | session theft | Medium | High | High | token fuerte/hash, cookie segura, rotation, revocation, HTTPS |
| SEC-RISK-008 | stale session tras cambio de permiso | Medium | High | High | Membership activa/versionada se valida por request sensible |
| SEC-RISK-009 | insecure password reset | Medium | Critical | High | token hash, breve, single-use, generic response, revoke sessions |
| SEC-RISK-010 | malicious upload / file parser exploit | Medium | High | High | allowlist, magic/MIME/decode, limits, private storage, no execution |
| SEC-RISK-011 | insecure direct file access | Medium | High | High | ownership tenant y signed URL breve tras autorización |
| SEC-RISK-012 | secret or backup exposure | Low | Critical | High | secret manager, least privilege, encryption, no public access |
| SEC-RISK-013 | CSRF | Medium | High | High | CSRF token, SameSite, Origin/Referer, safe-method discipline |
| SEC-RISK-014 | XSS | Medium | High | High | React escaping, no unsafe HTML, CSP, output encoding, no token in JS storage |
| SEC-RISK-015 | SQL injection | Low | Critical | High | Prisma/parameterization; unsafe raw APIs prohibited |
| SEC-RISK-016 | mass assignment | Medium | High | High | request DTO allowlists; server-controlled fields excluded |
| SEC-RISK-017 | vulnerable/compromised dependency | Medium | High | High | lockfile review, CI audit, minimal packages and permissions |
| SEC-RISK-018 | log leakage | Medium | High | High | structured allowlist/redaction and restricted retention/access |
| SEC-RISK-019 | account enumeration / timing | Medium | Medium | Medium | generic responses and comparable processing path |
| SEC-RISK-020 | denial of service / expensive queries | Medium | High | High | size/page/query/time limits, rate limiting and monitoring |
| SEC-RISK-021 | destructive historical mutation | Low | Critical | High | permissions, immutable lifecycle, constraints, reason and audit |
| SEC-RISK-022 | CORS/security-header misconfiguration | Medium | Medium | Medium | explicit config tests and environment allowlists |
| SEC-RISK-023 | internal operator overreach | Low | Critical | High | no permanent tenant access; explicit, time-bound, audited support access |
| SEC-RISK-024 | low-value metadata disclosure | Low | Low | Low | response minimization and safe 404 policy |

## 4. Authentication Architecture

V1 usa server-side sessions, no JWT persistido en LocalStorage:

1. User envía email y password por HTTPS.
2. Backend normaliza el identificador, ejecuta un flujo de verificación uniforme y valida Argon2id.
3. Si User está activo, crea una sesión server-side con token aleatorio.
4. Browser recibe únicamente el identificador opaco en cookie segura.
5. Browser envía la cookie automáticamente.
6. Backend hashea el token, resuelve sesión vigente y User activo.
7. Resuelve Current Organization y Membership activa.
8. Autoriza la permission de la operación y el ownership del recurso.

Una sesión autenticada no implica acceso a toda Organization ni a toda operación.

## 5. Password Storage

Se adopta **Argon2id**, memory-hard y apropiado para aplicaciones nuevas. Bcrypt queda solo como formato legacy/importación si apareciera esa necesidad.

- baseline inicial: al menos 19 MiB de memoria, 2 iteraciones y paralelismo 1; antes de producción se calibra hacia el mayor costo sostenible con un presupuesto de latencia y memoria definido;
- cada hash usa salt único generado por la librería;
- se almacena formato auto-descriptivo con algoritmo, versión y parámetros;
- al login, un hash con parámetros anteriores se rehashea después de autenticar correctamente;
- pepper solo como defensa futura si existe secret manager y procedimiento de rotación;
- nunca password plano, cifrado reversible, hint, log ni Audit Record.

## 6. Password Policy

- mínimo V1: 15 caracteres al no exigir MFA;
- máximo: 128 caracteres, con límite adicional de bytes documentado para evitar abuso sin truncar silenciosamente;
- permitir Unicode, espacios, copy/paste, autofill y password managers;
- no exigir símbolos/mayúsculas/dígitos específicos;
- no rotación periódica: cambio solo a pedido, reset, evidencia de compromiso o decisión administrativa justificada;
- comparar contra blocklist de passwords comunes/comprometidos antes de producción sin enviar el password completo a terceros;
- normalización Unicode, si se adopta, debe ser única, explícita y consistente antes de hash/verify; no se hace trim silencioso.

Strength y resistencia online son controles separados: una password larga no elimina rate limiting.

## 7. Login Security

- límites por IP/rango, identificador normalizado y combinación; no solo por cuenta;
- retraso progresivo acotado y respuesta genérica comparable para cuenta inexistente, password inválido o cuenta deshabilitada;
- sin bloqueo permanente por pocos intentos;
- fallos agregados y eventos anómalos se monitorean; audit/log no incluye password ni permite enumerar cuentas;
- éxito rota/crea session ID y limpia contadores pertinentes;
- CAPTCHA no es baseline y solo se evalúa como escalamiento ante abuso demostrado.

## 8. Session Storage

PostgreSQL es el store V1. `sessions` conserva ID interno, hash criptográfico del token opaco, User, expiración absoluta, revocación, creación, `last_seen_at` con throttling y metadata mínima.

El token browser tiene entropía criptográfica suficiente y nunca se deriva de UUID de recurso. Para lookup se usa un hash determinista seguro del token; las comparaciones de secretos son constant-time mediante librerías mantenidas. Session metadata no se usa como autenticador y se limita para privacidad.

## 9. Session Cookie

Producción:

- nombre con prefijo `__Host-` si Web/API y routing permiten host-only;
- `HttpOnly`; `Secure`; `SameSite=Lax`; `Path=/`; sin `Domain`;
- valor opaco sin User/Organization/roles;
- lifetime coherente con el servidor y eliminación explícita al logout.

Se elige Lax para permitir navegación legítima desde enlaces externos e invitaciones sin enviar cookie en `fetch` cross-site mutante. Strict puede adoptarse si pruebas UX lo permiten. `SameSite=None` requiere revisión de arquitectura y no se usa por defecto. JavaScript nunca lee la cookie.

## 10. Session Lifetime

Defaults iniciales configurables:

- idle timeout: 30 minutos;
- absolute lifetime: 12 horas;
- `last_seen_at` se actualiza con throttling para no escribir por request;
- actividad extiende solo idle, nunca absolute;
- rotación tras login, reset de password, cambio de privilegio/elevación y en una renovación periódica segura;
- `remember me` se difiere; requerirá token/serie separados, rotación y mayor protección.

Los valores reflejan una aplicación administrativa con datos comerciales; se revisan con evidencia de uso y threat model, no por conveniencia aislada.

## 11. Session Revocation

- logout revoca la sesión actual y borra cookie;
- User puede revocar una o todas sus sesiones;
- password change/reset, User Disabled y actividad sospechosa revocan todas las sesiones del User;
- Membership revocada bloquea inmediatamente esa Organization, sin necesariamente cerrar acceso legítimo a otras;
- Admin autorizado puede revocar sesiones según scope;
- cada request rechaza sesiones expired/revoked y Users Disabled.

Revocación es server-side; borrar solo la cookie no es suficiente.

## 12. CSRF

Toda operación state-changing (`POST`, `PUT`, `PATCH`, `DELETE`) exige token CSRF ligado a la sesión, enviado en header custom y comparado de forma segura. Además:

- SameSite=Lax;
- validación estricta de `Origin` contra allowlist; `Referer` seguro como fallback controlado;
- métodos GET/HEAD/OPTIONS no cambian estado;
- content types aceptados se restringen;
- login, logout, password reset y upload reciben análisis/protección equivalentes;
- fallo produce rechazo sin efecto parcial.

CORS no es defensa CSRF y SameSite no se usa como única barrera.

## 13. XSS

- usar escaping de React y output encoding por contexto;
- tratar nombres, notas, búsquedas, metadata y errores como input no confiable;
- prohibir rendering HTML peligroso salvo caso aprobado, sanitizador mantenido y tests;
- evitar URLs/esquemas peligrosos y handlers inline;
- sesión nunca en LocalStorage/SessionStorage ni accesible a JavaScript;
- CSP se prueba en staging y se hace enforce antes de producción con la mínima allowlist viable.

Sanitizar input no sustituye encoding de output; ambos responden a contextos distintos.

## 14. CORS

- allowlist exacta por environment, sin regex amplia ni reflexión de Origin;
- nunca `*` cuando `credentials=true`;
- solo métodos, headers y credentials necesarios;
- preflight y respuestas de error mantienen política consistente;
- local, staging y production no comparten origins;
- CORS controla lectura browser cross-origin, no autentica ni autoriza.

## 15. Authorization Model

V1 conserva roles aprobados en DATABASE.md: `Owner`, `Admin`, `Seller`, `Viewer`. No se introduce Manager ni IAM dinámico.

Permissions se definen en código por operación, por ejemplo:

- `inventory.read/create/update/adjust`;
- `inventory.equipment.delete-unreferenced`, `inventory.equipment.write-off`;
- `sales.read/create/confirm/cancel/correct`;
- `sales.financials.cost.read`, `sales.financials.profit.read`;
- `expenses.read/create/correct/void`;
- `warranties.read/manage`;
- `customers.read/manage`;
- `suppliers.read/manage`;
- `settings.manage`;
- `memberships.read/manage`;
- `audit.read`;
- `files.read/upload/delete`.

El mapping role→permission se centraliza, versiona y prueba. Owner no equivale a Platform Admin. Policies contextuales agregan ownership, estado y reglas de dominio; RBAC no autoriza por sí solo una transición inválida.

BCM inicia con un único User real Owner/Admin con acceso total dentro de su Organization. La preparación multi-user no cambia el modelo: Owner/Admin administran Memberships conforme a invariantes; Seller puede recibir ventas y stock sin obtener por defecto costos, Gross Profit, Business Result o Expenses; Viewer solo ve secciones concedidas. La visibilidad de navegación es UX, nunca reemplaza enforcement backend. No se crean custom roles ni un IAM dinámico.

## 16. Deny By Default

Toda ruta/caso de uso protegido empieza denegado. Solo permite cuando Authentication, User, sesión, Membership, Organization, permission, ownership y precondiciones aplicables son válidos. Permission inexistente, role desconocido, contexto ausente o policy error producen denegación. No existe fallback “permitir si no hay regla”.

## 17. Organization Context

La sesión guarda server-side un `current_organization_id` seleccionado, pero no lo considera autorización duradera. En cada request protegida el backend:

1. autentica User/session;
2. toma la Organization solicitada solo como selección;
3. carga Membership activa de ese User;
4. establece Current Organization Context validado;
5. autoriza la operación.

Un header/path/body `organization_id` nunca prueba acceso. Para Users con una Organization se selecciona automáticamente; con varias, switching explícito y auditado.

## 18. Tenant Isolation

| Layer | Control |
| --- | --- |
| Application | casos de uso reciben Current Organization validada |
| Persistence | repositories exigen tenant scope y no ofrecen lookup global por defecto |
| Database | FKs compuestas, UNIQUE/CHECK tenant-aware y privilegios mínimos |
| RLS | segunda barrera sobre tablas operativas seleccionadas |
| Testing | intentos read/write cross-tenant y contexto ausente |
| Observability | Organization/correlation ID sin PII excesiva |

Ninguna capa reemplaza a otra. Operaciones cross-tenant están prohibidas al rol normal y requieren capacidad de plataforma separada.

## 19. RLS Security Model

- cada operación tenant-owned abre transaction y fija el tenant mediante setting transaction-local equivalente a `set_config(..., true)`;
- la policy compara `organization_id` con ese contexto validado;
- contexto ausente/malformado no hace match: fail-closed;
- runtime role no es superuser, owner ni `BYPASSRLS`; tablas usan FORCE RLS cuando corresponda;
- migration/admin role es distinto, no está en las credenciales runtime y su uso se audita;
- `USING` protege filas existentes y `WITH CHECK` inserciones/updates;
- repository scoping y autorización siguen siendo obligatorios;
- no se usa setting de sesión persistente con connection pooling.

## 20. RLS Candidate Tables

RLS V1: `equipment`, `accessory_products`, catálogos tenant-owned, `customers`, `suppliers`, `sales`, todas sus lines/payments, `reservations`, `trade_ins`, ambos movement ledgers, `organization_settings`, `audit_records`, `stored_files` y relaciones de archivos, counters e idempotency keys.

Sin RLS tenant directa: `users`, credentials y `sessions` porque son identidad global; `organizations` y `organization_memberships` permanecen fuera de la policy operativa inicial para resolver bootstrap/switching mediante queries estrictas y permisos dedicados. Su incorporación se revisa cuando se cierre el flujo de administración cross-tenant. Excluir una tabla debe quedar explícito; una nueva tabla tenant-owned no se considera terminada sin decisión RLS.

## 21. Privileged Database Roles

### Migration/Admin role

Puede modificar schema/policies durante procesos controlados. Credencial separada, no disponible para requests normales, uso limitado a CI/deployment u operación aprobada y auditada.

### Application Runtime role

Solo connect/usage y operaciones DML estrictamente necesarias; sin superuser, ownership de tablas, `BYPASSRLS`, create database/schema/role, replication ni administración. La API nunca utiliza credenciales PostgreSQL administrativas. Un rol read-only operacional futuro también será separado.

## 22. IDOR / Broken Object Level Authorization

Patrón obligatorio: autenticar → resolver Organization/Membership → verificar permission → cargar el recurso con `(organization_id, id)` → aplicar policy de negocio → serializar respuesta mínima. Nunca se busca globalmente y se autoriza después de revelar datos. UUID reduce enumeración casual, pero no es control de autorización.

## 23. Mass Assignment

Request schemas usan allowlist por comando. No se persiste un objeto completo del browser ni se hace spread indiscriminado. Son siempre server-controlled, entre otros: `organization_id`, role/permission, ownership, `created_by`, historical cost, exchange snapshots, Sale status/totals, `confirmed_at`, `cancelled_at`, audit fields, stock y WAC. Una operación específica y autorizada es la única vía para cambiarlos.

## 24. Input Validation

1. **Request:** shape, tipos, longitud, formato, allowlist, cardinalidad y límites.
2. **Domain/Application:** permisos, estados, relaciones, Money, disponibilidad y reglas históricas.
3. **PostgreSQL:** NOT NULL, FK, UNIQUE, CHECK, RLS, locks y transactions.

Los tres niveles son complementarios. Prisma types no validan input no confiable ni sustituyen invariantes.

## 25. SQL Injection

Prisma y SQL parametrizado son obligatorios. `$queryRawUnsafe`, `$executeRawUnsafe` o equivalentes quedan prohibidos salvo incidente/excepción extraordinaria con security review documentado. Raw SQL permitido es parametrizado/TypedSQL, encapsulado en infrastructure, con input no interpolado, tests de abuso y revisión de permisos/RLS.

## 26. Error Security

La API devuelve errores públicos estables con status, code, mensaje seguro y correlation ID. Nunca stack, SQL, query parameters sensibles, connection string, secrets, rutas locales, password/session/token hashes ni internals. El log interno conserva diagnóstico sanitizado; errores de infraestructura se traducen sin ocultar el fallo operacional al monitoreo.

## 27. Resource Enumeration

- login/recovery/invitation usan respuestas genéricas y tiempo comparable;
- un ID de otra Organization se presenta como `404 Not Found` para no confirmar existencia;
- `401` indica ausencia/invalidación de Authentication;
- `403` se usa cuando el recurso pertenece al tenant actual pero falta permission;
- list/count/search nunca incluyen totales cross-tenant ni diferencias observables evitables.

Esta política no altera logs internos ni Audit Records autorizados.

## 28. File Upload Security

V1 acepta solo fotografías JPEG, PNG y WebP, con límite inicial configurable de 10 MiB y dimensiones/píxeles máximos para evitar decompression bombs.

- validar extensión como señal secundaria, MIME declarado, magic bytes y decodificación real;
- rechazar polyglots/contenido activo o formato no permitido;
- nombre y object key aleatorios generados por servidor; nunca path del User;
- upload requiere Authentication, permission, tenant ownership, CSRF y rate/size limits;
- storage privado, sin ejecución, sin servir con content sniffing;
- librerías de parsing aisladas, actualizadas y con recursos acotados;
- malware scanning/CDR se revisa si se habilitan documentos o riesgo real; no se envían archivos privados a un scanner público sin aprobación.

## 29. Object Storage Security

Bucket/container privado y separado por environment. Database conserva metadata y ownership; object key es interna y no constituye autorización. Download ocurre por streaming backend o signed URL de minutos, emitida solo después de validar session, Membership, permission y Organization. URLs no son permanentes, no se registran completas y el storage role tiene el scope mínimo.

## 30. Image Metadata

EXIF puede revelar ubicación, dispositivo y timestamps. Cuando exista pipeline de procesamiento, se recomienda re-encode/strip metadata y generar derivados seguros. No bloquea V1 si solo se aceptan fotos de producto y el pipeline aún no existe, pero se informa al operador y se registra como mejora prioritaria antes de permitir fotos de personas/documentos.

## 31. File Deletion

El cliente envía el ID de la relación de negocio, no una storage key ejecutable. Backend autoriza sobre Organization + entidad + permission, marca/elimina metadata conforme a lifecycle y elimina el objeto mediante workflow idempotente. Fallos parciales quedan reconciliables y auditados; nunca se permite delete directo del bucket. Archivos ligados a historia comercial respetan retención.

## 32. Rate Limiting

Prioridades: login, recovery, invitation/session creation, uploads, expensive search y exportaciones futuras.

- instancia única: limiter local con ventanas/buckets acotados para abuso general;
- identidad: contadores/ventanas persistentes por IP/rango, cuenta hasheada y operación para que restart no elimine protección;
- límites distintos por endpoint, respuesta `429` y `Retry-After` cuando corresponda;
- proxy IP solo se acepta desde proxies confiables configurados;
- si hay más de una réplica, el limiter local no es global: se reemplaza detrás de un adapter por store compartido/proveedor, sin introducir Redis antes de esa necesidad.

Rate limiting degrada abuso, no reemplaza password strength, authorization ni capacidad/timeout limits.

## 33. Password Recovery

1. Respuesta genérica y tiempo comparable exista o no la cuenta.
2. Si corresponde, generar token CSPRNG con alta entropía.
3. Persistir solo hash, purpose, User, expiry, created/used/revoked timestamps; token single-use.
4. Construir URL desde base confiable, nunca Host del request; no filtrar token por logs/Referer.
5. Tras token válido, establecer nueva password conforme a policy.
6. Marcar token usado atómicamente, revocar los demás tokens y todas las sesiones del User.
7. Notificar el cambio sin enviar password.

Recovery tiene rate limiting; security questions no son factor suficiente.

## 34. Email Verification

No hay flujo separado obligatorio en V1 porque el provisioning es administrativo/invitation-based. La aceptación de una invitación enviada al email bound demuestra control de esa casilla y debe registrarse. Para cuentas creadas manualmente sin esa prueba, recovery y acciones sensibles no se habilitan hasta confirmar el email mediante proceso administrativo seguro. Se revisa al abrir self-signup o comunicaciones sensibles.

## 35. MFA

MFA se difiere en V1, con riesgo residual de credential theft mitigado por sesiones, rate limiting, monitoreo y revocación. Evolución prioritaria: opcional y luego requerido para Owner/Admin según riesgo. Preferir WebAuthn/passkeys o TOTP con recovery codes protegidos; SMS no será la única estrategia recomendada. Su recuperación requiere threat model propio.

## 36. Account Provisioning

V1 usa alta administrativa e invitaciones. Invitation token es CSPRNG, hash-at-rest, expirable (default propuesto 24 horas), single-use, purpose/Organization/email bound y revocable. Aceptarlo no permite elegir Organization, role ni email distintos; esos valores provienen de la invitación autorizada. Crear/revocar invitación requiere `memberships.manage` y Audit Record.

## 37. Organization Switching

Current Organization se guarda server-side en Session para UX y cambia solo mediante comando explícito. El backend valida una Membership activa antes de escribir el nuevo contexto, rota estado CSRF si fuera necesario y audita switch con User, origen/destino y correlation ID. Cada request vuelve a validar Membership; el valor guardado no es autorización permanente ni puede sobrescribirse desde un Organization ID arbitrario.

## 38. Permission Changes

Membership conserva `authorization_version` o equivalente. Cambiar role/status incrementa esa versión y genera audit. Requests sensibles cargan Membership activa y comparan versión; V1 puede hacerlo en cada request tenant-owned por su escala. Caches futuros deben invalidarse o tener TTL corto fail-closed. Revocar Membership surte efecto inmediato para esa Organization; deshabilitar User revoca todas sus sesiones.

## 39. Sensitive Actions

Auditoría reforzada, permission específica, confirmación de intención y reason cuando corresponda para:

- confirmar/cancelar Sale y `Manual Resolution Required`;
- manual stock adjustment, cambiar costo o corrección histórica extraordinaria;
- cambiar exchange rate/settings críticos;
- invitar, cambiar role, revocar Membership, desactivar User/Organization;
- revocar sesiones/resetear credenciales;
- descargar/exportar datos sensibles;
- upload/delete de archivos vinculados;
- acceso administrativo de soporte.

Confirmación UI ayuda contra errores, pero backend vuelve a autorizar y validar.

## 40. Audit Security

Audit Records son tenant-owned, append-oriented y sin CRUD update/delete para runtime. `audit.read` se limita inicialmente a Owner/Admin; Seller/Viewer no acceden salvo permiso futuro explícito. Cada evento incluye actor o system, Organization, acción, entidad, reason, timestamp y correlation ID; before/after usa allowlist/redaction. Acceso, exportación y fallos de audit sensibles también se monitorean. Audit no almacena secretos ni sustituye ledgers de negocio.

## 41. Logging Security

Logs estructurados con allowlist y redaction central. Nunca password, session/reset/invitation/CSRF token, cookies, raw Authorization, DB/storage credentials, signed URL completa, password hash ni body sensible completo. Email/IP/user-agent y Customer PII se reducen, hashean o excluyen según necesidad. Acceso y retención se limitan por environment; sanitización evita log injection.

## 42. Correlation IDs

Cada request recibe/genera ID aleatorio no sensible, con formato/longitud validados si viene de proxy confiable. Se propaga a logs, error público y Audit Record/operación. No contiene User, email, Organization ni timestamp codificado como dato sensible y no funciona como autenticador.

## 43. Secrets Management

- nunca secrets en Git, `.env.example`, frontend bundle, logs o imagen de build;
- local: variables de entorno en archivo ignorado o tooling local seguro;
- staging/production: secret manager del proveedor e identidad de workload cuando exista;
- `.env.example` solo nombres y valores ficticios no funcionales;
- permisos por servicio/environment, inventario de owners, fecha/uso y rotación;
- ante filtración: revocar/rotar primero, investigar y limpiar historia sin creer que borrar un commit elimina el secreto.

## 44. Environment Separation

Local, test, staging y production usan databases, credentials, buckets, secrets, cookies/origins y cuentas externas separados. Production data no se copia a local/test; cualquier dataset futuro se minimiza y anonimiza mediante proceso aprobado. Staging no es una puerta lateral a production y nunca recibe credenciales productivas.

## 45. Dependency Security

- lockfile obligatorio y `frozen`/reproducible install en CI;
- dependencias mínimas, mantenidas y con propósito claro;
- audit/scanning de vulnerabilidades y licencias según pipeline futuro;
- triage considera versión, reachability, exploitability y mitigación, no solo severity del alerta;
- upgrades pequeños, testeados y con changelog;
- eliminar paquetes no usados; una función trivial no justifica una dependencia.

## 46. Supply Chain Security

Registry y scope se fijan; lockfile y scripts de instalación reciben review, especialmente cambios grandes. CI usa tokens breves/limitados, acciones/versiones pinneadas cuando sea viable y artefactos inmutables/provenance futura. PRs no confiables no acceden a secrets. Dependabot/Renovate o equivalente puede proponerse después de CI, con merge sujeto a tests/review.

## 47. Git Security

Repositorio privado inicialmente; main protegida al comenzar colaboración; cambios sensibles requieren review; commits pequeños; no force-push a main en flujo normal. Secret scanning se habilita cuando exista plataforma/CI. Production secrets nunca viven en source, Actions variables no protegidas, issues ni artifacts.

## 48. CI/CD Security

Pipeline con permisos mínimos y separación build/test versus deploy. PRs no confiables no reciben production secrets ni ejecutan en runners privilegiados persistentes. Deploy productivo usa environment protegido, approval cuando corresponda, artefacto ya construido e identidad corta; logs de CI se redactan. Migration/admin credentials solo existen durante el job autorizado.

## 49. HTTP Security Headers

Baseline antes del primer production deployment:

- CSP probada en staging y luego enforcing; objetivo `default-src 'self'`, sin `unsafe-eval`, con allowlists/nonces ajustados al frontend real;
- HSTS tras confirmar HTTPS en todo el dominio/subdominios aplicables;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin` o más restrictiva en recovery;
- `Permissions-Policy` deshabilita capacidades no usadas;
- `frame-ancestors` en CSP y/o `X-Frame-Options` legacy para impedir framing no autorizado;
- headers/cache control específicos para respuestas sensibles.

No se inventa una CSP incompatible antes de conocer assets/origins de deployment; su ausencia productiva tampoco es aceptable.

## 50. HTTPS

HTTPS obligatorio en production, con redirección o rechazo controlado de HTTP en edge/proxy y comunicación interna cifrada cuando la topología lo requiera. Cookies siempre Secure. TLS/certificados/ciphers se gestionan en infraestructura/proveedor mantenido; la API interpreta headers forwarded solo desde proxies confiables.

## 51. API Security

Todo endpoint sigue este pipeline:

1. Authentication, salvo rutas públicas explícitas.
2. Current Organization resolution cuando aplica.
3. Permission y resource ownership.
4. Request validation/allowlist.
5. Domain validation.
6. Transaction y database constraints/RLS.
7. Audit para acciones sensibles.
8. Safe response serialization y error controlado.

Controllers no consultan Prisma directamente ni devuelven entidades ORM completas. Las rutas públicas tienen threat model, rate limits y minimización propios.

## 52. Response Data Minimization

Responses usan contratos explícitos y devuelven solo campos necesarios para esa vista/permission. Siempre excluyen password hashes, credential/session/token internals, secrets, tenant security internals, metadata audit no requerida, signed URLs fuera de su caso y campos administrativos ocultos. Expand/include, export y field selection no quedan bajo control arbitrario del cliente.

## 53. Pagination and Abuse Protection

Todos los listados son paginados, con default y maximum page size definidos por recurso; filters/sorts son allowlists y los cursors están validados/ligados al orden esperado. Se limitan profundidad, cardinalidad, rango temporal y tamaño de respuesta. Exportaciones futuras son operaciones autorizadas, auditables y con cuotas; no una página sin límite.

## 54. Search Security

Input de búsqueda tiene longitud mínima/máxima, normalización, caracteres/operadores admitidos, timeout y page limit. Siempre parametrizado. El cliente no aporta regex, SQL, expresiones Prisma, nombres de columnas ni orden arbitrario. IMEI/SKU/sale number usan búsqueda exacta cuando corresponde; queries costosas reciben rate/cost limits y monitoreo.

## 55. Business Logic Security

Son incidentes de seguridad/integridad: vender Equipment dos veces, stock negativo, doble cancelación/reserva/Trade-In, vender reservado a otro Customer, cambiar Organization, reescribir costo/precio/cotización histórica o evadir `Manual Resolution Required`. Authorization, state machines, transactions, locks, constraints, idempotency y audit protegen conjuntamente. La UI no es una barrera.

## 56. Concurrency and Security

Requests paralelos o repetidos pueden ser intencionales. Los locks por fila, updates condicionales, orden estable de locks, CHECK/UNIQUE parciales, transacciones y failure atomicity de DATABASE.md son controles de seguridad. La permission y tenant context se validan dentro de la misma unidad transaccional cuando el tiempo entre check y use pueda cambiar el resultado.

## 57. Idempotency Security

Keys son CSPRNG o suficientemente impredecibles, tenant-scoped y operation-scoped; se asocian al hash canónico del request y resultado seguro. Reusar key con payload/operación incompatible es conflicto. Expiry/cleanup no permite repetir una operación mientras su efecto siga ambiguo. La key no autentica, no autoriza y nunca cambia Current Organization.

## 58. Financial Integrity

Historical cost, final price, exchange-rate snapshot, Trade-In value, WAC aplicado, Sales Revenue, COGS, Gross Profit, Expenses y Business Result son protegidos contra mass assignment y mutation ordinaria. Sale Correction exige `sales.correct`, reason, valores before/after, audit y operación de dominio que preserve el original. Lecturas de costos/profit/expenses y sus exportaciones aplican permissions separadas y tenant scope más estrictos que datos públicos de catálogo.

## 59. Backup Security

Backups se tratan como production data: cifrado at rest/in transit cuando el proveedor lo permita, acceso restringido y auditado, cuenta/bucket no públicos, retención y eliminación definidas en BCM-010, copies cross-environment prohibidas y restore tests periódicos aislados. Database y object storage se coordinan. Nunca se descargan a dispositivos personales sin proceso excepcional aprobado.

## 60. Database Network Security

PostgreSQL production no se expone públicamente cuando exista red privada; network allowlist/firewall limita API, migrations y operadores autorizados. TLS y verificación de certificado se configuran según proveedor. Runtime/admin credentials son distintas, rotables y secret-managed. Browser/frontend nunca conecta directamente a DB.

## 61. RLS Failure Modes

| Failure mode | Control |
| --- | --- |
| conexión pooled reutiliza tenant viejo | solo context transaction-local; reset implícito al finalizar |
| contexto ausente/malformado | policy fail-closed y test explícito |
| tabla nueva sin policy | migration checklist + schema test que enumera tablas tenant-owned |
| runtime usa role admin/owner | identity/config assertion en startup y deployment test |
| migration deshabilita RLS | SQL review, test post-migration y no deploy si falta policy |
| raw query supone bypass o scope | parametrización, wrapper, review y test cross-tenant |
| policy permisiva combinada con OR abre acceso | policy inventory y tests por comando/role |
| FK/UNIQUE revela existencia cross-tenant | errores genéricos y constraints tenant-aware; review de covert channels |
| backup omite filas por RLS | backup role/proceso separado y restore verification |

## 62. RLS Testing Requirements

Database integration tests con el role runtime real demuestran que Organization A no lee, inserta, actualiza ni elimina datos de B; inserts/updates no pueden cambiar `organization_id`; sin tenant context no hay filas/operación válida; contexto no persiste tras devolver conexión al pool; runtime no es owner ni `BYPASSRLS`; cada tabla candidate tiene RLS/policies/FORCE esperado.

## 63. Authorization Testing

Por operación sensible: caso permitido; sin Authentication → 401; autenticado sin permission → 403; recurso de otro tenant → 404/no accesible; role/Membership removidos → acceso desaparece; Organization switch inválido → rechazo; campos server-controlled → rechazo/ignorados según contrato; last Owner y acciones destructivas siguen reglas específicas.

## 64. Authentication Testing

Valid/invalid login, User Disabled, generic account response, session malformed/expired/revoked, logout y replay, idle/absolute timeout, token rotation, password rehash, recovery expiry/reuse/race, invitation binding/reuse, revocación tras password reset y brute-force/rate-limit behavior. Tests nunca imprimen secretos reales.

## 65. File Security Testing

Rechazo de tipo no admitido, oversize, dimensiones/decompression bomb, MIME/extensión/magic mismatch, nombre/path malicioso, contenido activo, acceso sin permission y cross-tenant, key manipulada, signed URL expirada, delete repetido y fallo parcial storage/metadata. Verificar headers seguros al servir.

## 66. Security Review Per Feature

Checklist reusable de discovery/review:

- Authentication y session lifecycle;
- permission, role y destructive actions;
- Current Organization, query scope y cross-tenant tests;
- request/domain/database validation;
- sensitive input/output, privacy, logs y audit;
- transactions, concurrency e idempotency;
- file upload/access/delete;
- abuse, pagination, rate/cost limits;
- errors, headers, secrets/dependencies y failure behavior.

## 67. Security Definition of Done

Una feature sensible no está terminada hasta tener permissions mapeadas, deny-by-default, tenant scope y tests negativos, input allowlist, errores/responses seguros, logs sanitizados, Audit Record cuando aplica, constraints/transacción/concurrency adecuadas y ningún secret en código. Todo riesgo aceptado tiene owner, rationale y review trigger.

## 68. Security Incident Preparation

V1 conserva correlation ID, timestamps UTC, User/session interna, Organization, acción, resultado, source metadata limitada y Audit Records para reconstruir quién, qué, cuándo y contexto. Debe ser posible revocar sesiones/secrets, deshabilitar User/Membership, identificar Organizations afectadas y preservar evidencia. Playbooks, contactos, severidad, retención y notificación se definen antes de production; no se introduce SIEM complejo.

## 69. Data Privacy

Customer/User data es privada aunque no sea una categoría legal especial declarada. Recopilar solo lo necesario, limitar por permission/tenant, no registrar indiscriminadamente, definir retención/anonimización futura y proteger exports/backups. Acceso administrativo no implica uso libre. Obligaciones legales concretas se evalúan con asesoramiento y jurisdicción, no se inventan aquí.

## 70. Administrative Access

Developers/operators no tienen acceso permanente a datos tenant. Soporte futuro requiere ticket/reason, scope explícito, aprobación, credencial individual, tiempo limitado cuando sea posible y audit reforzado. Se prefieren diagnósticos sin contenido y datos redactados. No hay shared accounts ni impersonation V1; break-glass futuro requiere custodia, alerta y revisión posterior.

## 71. Super Admin

V1 **no crea Platform Super Admin universal**. Roles Owner/Admin pertenecen a una Organization. Provisioning de plataforma se hace mediante operación separada y controlada que no concede lectura automática de datos comerciales. Si escala soporte multi-tenant, se diseñará capability/platform identity separada, granular, JIT/time-bound y auditada; nunca un role de Membership reutilizado.

## 72. Destructive Operations

| Operación | Controles mínimos |
| --- | --- |
| Cancel Sale | permission, reversibility, idempotency, reason, transaction, audit |
| Correct Confirmed Sale | `sales.correct`, dependency/reversibility check, before/after, reason, idempotency, transaction, audit |
| “Delete” Confirmed Sale | se autoriza como cancel/void/reversal; nunca physical delete comercial |
| Manual stock adjustment | permission específica, delta/cause, actor, lock, audit |
| Write off Equipment for theft/loss | `inventory.equipment.write-off`, valid state, cause, actor, movement, transaction, audit |
| Physically delete erroneous Equipment | `inventory.equipment.delete-unreferenced`, proof of no history/dependencies, reason, transaction, audit |
| Record/correct/void Expense | permission específica, financial before/after, reason for correction/void, audit |
| Manage Warranty | permission específica, coverage/expiry allowlist, tenant ownership, audit |
| Deactivate Organization/User | permiso elevado, impacto/sesiones, confirmación, reason, audit |
| Delete file | ownership de entidad, lifecycle/retention, idempotency, audit |
| Change Membership role/status | `memberships.manage`, no self-escalation, invariantes Owner, version bump, audit |

La confirmación visual nunca reemplaza control backend.

## 73. Account Enumeration

Login y recovery responden genéricamente, por ejemplo: “Si la cuenta existe, se enviarán instrucciones”. Status/body y timing evitan diferencias obvias entre inexistente, disabled o válido. Rate limits no revelan contadores por cuenta; logs internos pueden distinguir casos sin exponerlos al cliente.

## 74. Timing Attacks

Password verification sigue camino comparable, usando un hash dummy calibrado cuando el User no existe. Hash/token/CSRF comparisons usan primitives constant-time de librerías mantenidas; no comparaciones caseras. Respuestas remotas no prometen tiempo idéntico, pero eliminan branches y diferencias evitables que faciliten enumeración.

## 75. Token Generation

Session, recovery, invitation y otros bearer tokens usan CSPRNG, al menos 128 bits de entropía efectiva y encoding URL-safe cuando corresponda. Son purpose/subject/expiry bound, hash-at-rest, single-use si el flujo lo exige y nunca IDs de recursos. Tokens no viajan en logs; URLs sensibles reducen Referrer/cache y expiran pronto.

## 76. Security Decision Register

| ID | Decision | Status | Rationale | Review Trigger |
| --- | --- | --- | --- | --- |
| SEC-DEC-001 | Argon2id versionado/calibrado | Accepted | memory-hard para sistema nuevo | benchmark/hardware o nueva guía |
| SEC-DEC-002 | cookie HttpOnly/Secure/SameSite=Lax host-only | Accepted | sesión first-party con navegación externa legítima | domains/cross-site cambian |
| SEC-DEC-003 | CSRF token + Origin/Referer + SameSite | Accepted | cookie auth requiere defensa dedicada | arquitectura browser cambia |
| SEC-DEC-004 | RLS parcial operational, fail-closed | Accepted | defense in depth tenant | nuevas tablas/pooling/modelo tenant |
| SEC-DEC-005 | RBAC code-defined por Membership | Accepted | simple, auditable, suficiente V1 | custom roles/ABAC requerido |
| SEC-DEC-006 | private files + authorized short signed URL | Accepted | evita acceso directo/público | nuevo tipo de archivo/CDN público |
| SEC-DEC-007 | rate limit local + estado identity persistente; adapter | Accepted | una instancia sin Redis y protección durable | segunda réplica/abuso sostenido |
| SEC-DEC-008 | MFA diferido; WebAuthn/TOTP futuro Owner/Admin | Deferred | no requisito V1, riesgo residual conocido | primer production review/incidente/cliente |
| SEC-DEC-009 | verificación separada diferida; invitation acceptance verifica | Accepted V1 | provisioning administrado | self-signup o email sensible |
| SEC-DEC-010 | sin Platform Super Admin universal | Accepted | least privilege y tenant isolation | soporte multi-tenant operativo |
| SEC-DEC-011 | password 15–128, sin composition/expiry arbitrarios | Accepted | password-only V1, password managers | MFA obligatorio/nueva guía |
| SEC-DEC-012 | PostgreSQL session store, token hash only | Accepted | ADR-006 y escala V1 | performance/replicas justifican otro store |
| SEC-DEC-013 | 30m idle / 12h absolute configurables | Accepted | aplicación administrativa | evidencia UX/riesgo |
| SEC-DEC-014 | session guarda current org pero revalida Membership | Accepted | switching claro sin confiar en client | cache/escala cambia |
| SEC-DEC-015 | recovery/invitation tokens hash, brief, single-use | Accepted | limita robo/replay | identity provider externo |
| SEC-DEC-016 | secretos en provider secret manager | Accepted | no source/logs y rotación | elección de deployment |
| SEC-DEC-017 | Audit append-only; lectura Owner/Admin | Accepted | trazabilidad con exposición limitada | rol auditor dedicado |
| SEC-DEC-018 | security headers enforcing antes de production | Accepted | defensa browser baseline | frontend/origins definidos |
| SEC-DEC-019 | lockfile, audit y review supply-chain | Accepted | reproducibilidad y riesgo de paquetes | CI/package manager definido |
| SEC-DEC-020 | financial visibility separated by semantic permission | Accepted | Seller puede operar ventas/stock sin costos, profit o gastos | nueva matriz de roles o reporting |
| SEC-DEC-021 | corrections, voids and write-offs require dedicated permissions | Accepted | acciones históricas/destructivas necesitan least privilege, reason y audit | implementación de cada capability |

## 77. Security Controls Matrix

| Control | Threat | Layer | Required V1 | Validation |
| --- | --- | --- | --- | --- |
| scoped repositories | cross-tenant leakage/IDOR | Application/Persistence | Yes | integration tests A/B |
| tenant-aware FKs | cross-tenant relation | Database | Yes | constraint tests |
| RLS candidates | leakage/raw query error | Database | Partial V1 | runtime-role DB tests |
| RBAC deny-by-default | privilege escalation | Application | Yes | permission matrix tests |
| Argon2id | offline cracking | Identity | Yes | config/hash/rehash tests |
| login/recovery limiter | brute force/enumeration | API/Identity | Yes | threshold/concurrency tests |
| hashed opaque session | session DB theft | Identity/DB | Yes | storage inspection |
| secure cookie | theft/CSRF | Browser | Yes | config/E2E test |
| CSRF token + Origin | CSRF | Browser/API | Yes | negative API tests |
| request allowlists | injection/mass assignment | API | Yes | malformed/extra field tests |
| parameterized SQL | SQL injection | Persistence | Yes | static review/integration |
| private object storage | file disclosure | Storage/API | Yes | unauthorized/cross-tenant tests |
| upload validation | malicious files/DoS | API/Storage | Yes | file security suite |
| safe error/response DTO | information disclosure | API | Yes | contract tests |
| audit append-only | repudiation/tampering | Application/DB | Yes | privilege + mutation tests |
| log redaction | secret/PII leakage | Observability | Yes | redaction tests/review |
| transaction/locks/idempotency | race/business abuse | Domain/DB | Yes | concurrent integration tests |
| HTTPS/headers | transport/browser attacks | Edge/Web | Yes before production | deployment scan/config test |
| secret manager/separation | credential leak | Deployment | Yes before production | config/access review |
| dependency controls | supply-chain | Repository/CI | Yes before production | lockfile/audit gates |
| MFA | credential theft | Identity | No, planned | future E2E/security review |

## 78. Explicit Security Non-Goals V1

Sin necesidad demostrada no se introduce enterprise SSO/SAML, custom cryptography, HSM propio, SIEM complejo, WAF como sustituto de código seguro, full zero-trust platform, MFA obligatorio para todos desde día uno, ABAC/IAM dinámico, custom identity provider, impersonation, Redis obligatorio ni antivirus/CDR empresarial para simples fotos. Se preservan interfaces y review triggers para evolucionar.

## 79. Security Roadmap

### Before first production deployment

Authentication/session/recovery/invitation implementados y testeados; Argon2id/password blocklist; RBAC/tenant scoping/RLS y tests A/B; CSRF/CORS/cookies/HTTPS/headers; safe validation/errors/responses; file privacy/limits; audit/log redaction/correlation; rate limits de identidad; secret/environment separation; dependency/CI controls; backup/restore y incident playbook mínimos.

### Shortly after production

Re-encoding/EXIF stripping, automatización de dependency updates, alertas de abuso, user-facing session management, tabletop de incidente, tuning de limits/timeouts y evaluación MFA Owner/Admin.

### Future maturity

WebAuthn/TOTP, JIT support access, security scanning avanzado, provenance/signing, WAF por evidencia, SIEM si escala, data-retention/privacy automation y store distribuido de sessions/rate limits si hay replicas/carga.

## 80. Security Checklist

### Identity

- [ ] ¿Authentication requerida y session vigente?
- [ ] ¿User Disabled/revoked/expired bloqueado?
- [ ] ¿Tokens y passwords nunca se exponen?

### Authorization

- [ ] ¿Permission por operación y deny-by-default?
- [ ] ¿Acción destructiva exige permiso, reason y audit?

### Tenant

- [ ] ¿Organization deriva de session + Membership activa?
- [ ] ¿Toda query/relación está scoped y RLS decidida?
- [ ] ¿Existe test cross-tenant read/write?

### Input

- [ ] ¿Request usa allowlist, límites y tipos?
- [ ] ¿Domain validation y DB constraint protegen la invariante?
- [ ] ¿No hay mass assignment ni SQL no parametrizado?

### Output

- [ ] ¿Response minimizada y sin fields sensibles?
- [ ] ¿Errores no filtran existencia/internals?

### Data

- [ ] ¿Historia económica permanece inmutable?
- [ ] ¿Audit requerida, sanitizada y append-only?

### Files

- [ ] ¿Tipo/tamaño/contenido validados?
- [ ] ¿Storage privado y ownership tenant comprobado?
- [ ] ¿Delete/download no aceptan key como autorización?

### Abuse

- [ ] ¿Rate limiting/cost limits necesarios?
- [ ] ¿Pagination, filter y sort están acotados?

### Logging

- [ ] ¿Secrets/PII redactados y correlation ID presente?

### Tests

- [ ] ¿Casos positivo, sin auth, sin permission, cross-tenant y concurrente?

## Architecture and database review

**Architecture Review Required:** No.

Las decisiones respetan el modular monolith, REST, server-side sessions, PostgreSQL shared multi-tenancy, Prisma encapsulado, object storage privado y ausencia inicial de Redis definidos en BCM-003/ADRs.

**Database Review Required:** Yes — additive follow-up before identity implementation.

No existe contradicción con DATABASE.md, pero la persistencia conceptual de security exige definir mediante una revisión posterior y migrations futuras:

- password reset tokens e invitation tokens hash-at-rest;
- `authorization_version` de Membership y current Organization/version observada por Session;
- estado persistente mínimo de rate limiting de identidad;
- constraints, retención, índices y RLS/exclusión de esas tablas.

Esta tarea no modifica `DATABASE.md`, Prisma ni PostgreSQL.

## Mandatory review result

Revisión realizada contra PRODUCT, DOMAIN completo, ARCHITECTURE, DATABASE y todos los ADRs:

- tenant isolation: cubierto en Application, Persistence, constraints, RLS y tests;
- sessions: hash-at-rest, cookies, timeout, rotation y revocation coherentes con ADR-006;
- RLS: fail-closed, transaction-local, roles separados y failure modes cubiertos;
- files: privados, tenant-owned, validados, autorizados y no ejecutables;
- financial integrity/destructive actions: permissions, history, locks, idempotency y audit;
- frontend: ningún control depende exclusivamente de UI/CORS/UUID;
- secrets/tokens: CSPRNG, hash-at-rest, redaction y secret manager;
- scope: sin SSO, IAM dinámico, Redis, SIEM o infraestructura prematura.

No se detectaron contradicciones arquitectónicas. La revisión de base requerida es aditiva y está delimitada arriba.

## Technical references

- OWASP Application Security Verification Standard 5.0.0.
- OWASP Cheat Sheet Series: Password Storage, Authentication, Forgot Password, CSRF Prevention, File Upload e Input Validation.
- NIST SP 800-63B: passwords, blocklists, rate limiting y authenticator lifecycle.
- PostgreSQL: Row Security Policies y database roles.
- MDN: secure cookie configuration y session management.

Son referencias de diseño; BCM SOFT no declara cumplimiento o certificación formal en esta fase.

## Completion status

**Estado:** Completed

BCM-005 documenta arquitectura y estándares; no implementa guards, middleware, cookies, hashing, RLS, Prisma, migrations, object storage, CI ni dependencias. BCM-006 permanece pendiente.
