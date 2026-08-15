# BCM SOFT — Deployment & Operations Strategy

Propósito: definir una estrategia simple, segura y repetible para desarrollar, desplegar, operar y recuperar BCM SOFT.

Estado: `Completed`.

Alcance: decisiones documentales para V1 y crecimiento. Esta fase no despliega, instala herramientas, configura CI/cloud, crea Dockerfiles ni genera migrations.

## 1. Deployment principles

1. Builds reproducibles y artefactos identificables.
2. Entornos y credenciales separados.
3. Production nunca es desarrollo ni testing.
4. Migrations versionadas, revisadas y probadas.
5. Secrets fuera del código y artefactos.
6. Staging antes de production.
7. Rollback planificado antes del deploy.
8. Backup solo es válido si puede restaurarse.
9. Observabilidad forma parte del release.
10. `main` permanece deployable.
11. Infraestructura administrada primero.
12. Evitar operación que requiera dedicación full-time.

## 2. Environments

| Entorno | Uso | Datos y operación |
|---|---|---|
| Local | Desarrollo individual y debugging | PostgreSQL local/efímero, secrets ficticios, logs pretty. |
| Test | Suites automatizadas y CI | Infraestructura efímera, datos sintéticos, sin integraciones reales. |
| Staging | Validación production-like | Servicios persistentes separados, datos sintéticos realistas, migrations/smoke/E2E/load controlado. |
| Production | Operación de clientes reales | Acceso mínimo, backups/PITR, monitoring, cambios solo mediante pipeline aprobado. |

Un entorno nunca reutiliza recursos durables de otro.

## 3. Environment isolation

Local/test/staging/production tienen PostgreSQL databases, roles, object storage, secrets, Sentry environment/projects, cookies/domains y API URLs separados. Staging replica comportamiento y seguridad sin copiar datos reales. Las redes del proveedor deben impedir referencias accidentales entre staging y production cuando la capacidad exista.

## 4. Local development

El onboarding debe estar documentado en README y fijar Node/pnpm, variables públicas/ficticias, PostgreSQL, migrations y comandos. PostgreSQL puede ejecutarse nativo o mediante contenedor/Testcontainers; Docker no es obligatorio para Web/API. Un desarrollador nuevo debe levantar el sistema sin conocimiento tribal ni credenciales compartidas.

## 5. Runtime versions

V1 fija **Node.js 24 LTS** por major y una versión minor/patch reproducible en tooling/CI; upgrades dentro de LTS se revisan periódicamente. No usar Node Current ni `latest` en production. PostgreSQL usa una major soportada por proveedor, Prisma y tests —preferencia inicial 18 si la matriz de compatibilidad lo confirma—, idéntica en test/staging/production y siempre en minor soportada. pnpm también se fija en `packageManager` y CI.

## 6. Package manager

Se adopta **pnpm workspaces** con `pnpm-workspace.yaml`, un `pnpm-lock.yaml` raíz y protocolo `workspace:` para paquetes internos. Aporta soporte monorepo, instalación eficiente y dependencias estrictas sin añadir un orchestrator. CI usa instalación frozen; npm/yarn no se mezclan ni generan lockfiles alternativos.

## 7. Build architecture

Web y API se construyen por separado desde el monorepo. Web produce el build estático Vite; API compila TypeScript/NestJS a un runtime Node de producción, sin depender de source TS o dev server. Pueden compartir commit/release coordinado, pero conservan artefactos, health y rollback independientes.

## 8. Artifact immutability

El artefacto que pasa tests y staging es el promovido a production cuando el proveedor lo permita. No recompilar manualmente con código/config distintos. Configuración runtime y secrets se inyectan por environment; toda configuración pública embebida en Web exige build identificado y, si cambia, nuevo artefacto.

## 9. Frontend hosting

Usar **static managed hosting/CDN** con HTTPS, custom domain, SPA fallback, immutable hashed assets, control de cache del HTML, previews y rollback. No necesita contenedor ni servidor Node. La marca se decide en bootstrap comparando región/CDN, integración CI, headers/rewrites, costos y rollback.

## 10. API hosting

Usar **managed application hosting** capaz de ejecutar Node/OCI de forma persistente, terminar TLS, inyectar secrets, consultar health, hacer graceful deploy, centralizar logs y escalar a réplicas. Debe conectarse privadamente a PostgreSQL si es posible. No Kubernetes, VM administrada manualmente ni serverless con semántica incompatible con conexiones/sesiones sin evaluación.

## 11. PostgreSQL hosting

Production y staging usan **PostgreSQL administrado** separado con TLS, backups automáticos, PITR production, monitoring de conexiones/queries, upgrades, restore aislado y región compatible con API. La API se conecta por red privada cuando sea viable. No operar PostgreSQL en una VM propia.

## 12. Object storage

Production usa bucket/container privado, separado de staging, con signed operations, lifecycle, cifrado/durabilidad del proveedor, credenciales mínimas y opción de versioning/recovery. El browser nunca recibe credentials permanentes. La marca S3-compatible se decide junto con región, egress y recuperación.

## 13. Provider strategy

Se adopta **B: decidir por capacidades durante bootstrap/deployment**, no contratar ahora. Se busca primero una combinación coherente de proveedor managed para API+DB en la misma región, static CDN, storage privado, Sentry y uptime externo. No multi-cloud activo ni abstracciones ficticias; se preservan PostgreSQL estándar, OCI y S3-compatible para portabilidad razonable.

## 14. Candidate hosting options

| Opción | Fortaleza potencial | Verificación obligatoria antes de elegir |
|---|---|---|
| Render | Static CDN, Web services, private network y managed PostgreSQL/PITR integrados | Latencia desde Argentina, regiones disponibles, ventana PITR, precio y environment isolation. |
| Railway | Deploy simple, environments/private networking, servicios y PostgreSQL | Regiones, madurez/operación de PITR, límites, métricas y costo real. |
| Fly.io | API regional flexible, incluida São Paulo, OCI y scaling | Mayor carga operativa, estado/backup de Managed Postgres y private networking. |
| Vercel / Cloudflare Pages | Excelente static hosting/CDN/previews para Web | Agrega proveedor; SPA rewrites, headers, egress y dominio. |
| Neon / Supabase | PostgreSQL managed, branching/backup/PITR según plan | Región, RLS/roles Prisma, pool mode, PITR/costo y networking con API. |
| RDS-like | PostgreSQL maduro, red privada, backups/PITR y control regional | Mayor configuración/costo/operación inicial. |

Precios, planes y regiones son variables: se verifican con documentación y prueba de latencia al contratar.

## 15. Recommended initial topology

```text
Users
  |
  v
Static Web Host / CDN
  |
  v
Managed Node API
  |-- private/secured --> Managed PostgreSQL + PITR
  |-- private signed --> Private Object Storage
  |--------------------> Sentry / managed logs & metrics

External Uptime Monitor --> Web + API health
```

Una instancia API inicial alcanza para 10–40 usuarios si load tests lo confirman. Esta topología minimiza operación, mantiene durables fuera del proceso y permite réplicas futuras.

## 16. Regions

Elegir una región con latencia aceptable para Argentina y colocar **API y DB en la misma región/red**, prioridad superior a acercar solo la Web. Medir candidatos —incluida São Paulo cuando esté disponible— desde usuarios reales y staging. La región final queda Pending hasta verificar disponibilidad, residencia de datos, PITR, costo y latencia.

## 17. Domain strategy

Recomendación: subdominios bajo el mismo registrable domain, por ejemplo `app.<domain>` y `api.<domain>`, sin registrar nombres ahora. Staging usa subdominios distintos y cookies separadas. Esta topología conserva Web/API deployables por separado y simplifica same-site cookies, Origin/CSRF y soporte.

## 18. Cookie deployment implications

Preferir same-site HTTPS subdomains. La cookie de sesión es host-only para API, `HttpOnly`, `Secure`, `SameSite=Lax` y path mínimo; Web usa `credentials: include`. CORS permite exactamente el origin Web autorizado y credentials; CSRF exige token/header y Origin allowlist. Un diseño cross-site solo se acepta tras Security Review porque cambia SameSite/CORS/CSRF y privacidad.

## 19. Reverse proxy / ingress

El managed provider termina TLS/proxy; no Nginx propio. Configurar trust proxy solo para hops conocidos, validar forwarded IP/proto/request IDs, límites de body, headers y timeouts coherentes con API. Headers arbitrarios del cliente no se consideran confiables.

## 20. HTTPS

HTTPS es obligatorio en staging/production externos; HTTP redirige o no se expone. Certificados se gestionan automáticamente cuando sea posible. HSTS se habilita después de validar dominio/subdominios y proceso de renovación/rollback, conforme a SECURITY.

## 21. Secrets

Inventario mínimo: `DATABASE_URL` runtime/migration separadas, session/key material, HMAC/token hashing, Sentry server/build credentials, storage access y futuras email credentials. Viven en secret/environment manager, separados por environment y no en Git, image, frontend bundle o documentación. Cada secret tiene owner, purpose y consumidores.

## 22. Secret rotation

Diseñar dual-key/grace period cuando el tipo lo requiera y procedimiento para DB credentials, HMAC/key material y provider tokens. Rotar ante exposición, cambio de acceso o recomendación fundada, no calendario arbitrario. La rotación incluye revocar anterior, redeploy, verificar y registrar incidente/cambio.

## 23. Frontend environment variables

Todo `VITE_*`/valor embebido es público. Solo API public URL, release ID y DSN/config pública de observabilidad diseñada para browser. Nunca DB URL, storage credential, Sentry auth token de upload, session/HMAC secret ni feature permission autoritativa.

## 24. Backend configuration

Validar schema de environment al startup, distinguir required por entorno y fail-fast con mensaje sanitizado. Production no usa defaults inseguros ni archivos `.env` dentro del artefacto. Config se accede por módulo/adaptador central, no `process.env` disperso.

## 25. Infrastructure as Code

V1 **difiere Terraform/Pulumi**. Usar configuración declarativa nativa del proveedor cuando exista, export/documento del estado y DEP-DEC register. Introducir IaC cuando haya drift repetido, múltiples servicios/regions, recreación difícil, segundo operador, requisitos auditables o cambios manuales frecuentes. Clicks sin documentación no son estado final aceptable.

## 26. Containerization

Decisión: API **container-first para production**, con OCI image reproducible cuando el proveedor lo soporte; también puede usar native build inicialmente solo si promueve el mismo artefacto y reduce complejidad demostrablemente. Web no usa container. Local ejecuta apps nativamente; contenedores son opcionales para dependencias.

## 27. Docker image principles

La futura image API será multi-stage, runtime mínima, user non-root, sin dev dependencies/secrets/source innecesario, base major/digest revisado, graceful signals y health-compatible. Labels incluyen release; builds son reproducibles y escaneables. No se crea Dockerfile en BCM-010.

## 28. Docker Compose

Puede orquestar PostgreSQL/object-storage fake local si mejora onboarding. No es requisito para ejecutar cada proceso ni plataforma production/staging. Testcontainers sigue siendo preferido para integration aislada cuando corresponda.

## 29. CI provider

Se adopta **GitHub Actions** por integración con el repositorio, checks, environments, artifacts y controles de permisos. La configuración llegará en una tarea posterior; no se agrega otro CI sin limitación concreta.

## 30. CI security

Workflows usan permisos mínimos, actions oficiales/revisadas fijadas por commit SHA cuando sea práctico, OIDC/credenciales efímeras hacia cloud, environment secrets y concurrency controls. PRs no confiables no reciben production secrets. Environments protegidos separan staging/production; masking no sustituye evitar imprimir secrets.

## 31. Pull Request CI

Pipeline conceptual: frozen install; format; lint/architecture; typecheck; unit/component; PostgreSQL integration; API/security/concurrency según paths/riesgo; builds Web/API; E2E seleccionado. Jobs rápidos fallan primero y los independientes paralelizan. Ningún PR despliega production ni accede a sus secrets.

## 32. Main CI

Cada merge ejecuta gates amplios necesarios para mantener `main` deployable, construye artefactos identificados y, si todo pasa, inicia promoción a staging. Mandatory failure bloquea deploy; no marcar verde ignorando suites flaky o fallos de seguridad.

## 33. Staging deployment

Preferencia: despliegue **automático desde `main`** después de CI, serializado para no solapar releases. Ejecuta migration con identidad dedicada, API/Web deploy, readiness, smoke, E2E críticos, observability synthetic y validación de release. Cambios excepcionales pueden requerir aprobación manual antes de migration sensible.

## 34. Production deployment

Promoción reproducible del release verificado mediante pipeline/provider, nunca `git pull`. V1 exige **aprobación manual** y checklist, idealmente con GitHub Environment; si el plan privado no soporta reviewer gate, el provider/pipeline debe registrar aprobación equivalente. Solo `main`/tag autorizado y un deployment production a la vez.

## 35. Deployment frequency

Sin calendario fijo. Preferir cambios pequeños y frecuentes tras staging, evitando lotes gigantes y deploys sin capacidad de observar. El momento considera disponibilidad de quien puede responder, no una prohibición ritual de días.

## 36. Branch strategy

Adoptar **trunk-based simple**: `main` + feature/hotfix branches cortas + PR. No GitFlow ni ramas permanentes de release/develop. Feature incompleta no se mergea salvo que esté segura detrás de capacidad explícita; flags no sustituyen autorización.

## 37. Branch protection

Antes de producción, proteger `main`: PR/checks requeridos, no force push/delete y merge solo con branch actualizada según necesidad. Para un único desarrollador, review humana adicional puede ser opcional pero CI y production approval no; aumentar reviewers cuando crezca el equipo.

## 38. Commit strategy

Commits pequeños, descriptivos y enfocados. Conventional Commits es convención recomendada (`feat`, `fix`, `docs`, `chore`) para historial/release notes, sin imponer scopes ceremoniales. No mezclar secretos, generated artifacts o refactors ajenos.

## 39. Release versioning

Usar SemVer. Mientras contratos/producto no sean estables, `0.MINOR.PATCH`: MINOR agrega capability compatible, PATCH corrige sin cambio incompatible. `1.0.0` requiere baseline productivo estable; luego MAJOR marca incompatibilidad planificada. Version no reemplaza commit SHA/build ID.

## 40. Release artifacts

Web artifact, API OCI/build y migration set registran version, commit SHA y build ID. Checksums/provenance pueden agregarse mediante CI. Deployment marker enlaza artifacts exactos; no usar solo nombre de branch o timestamp como identidad.

## 41. Database migration workflow

Generar migration en desarrollo, revisar SQL/locks/data impact/compatibility en PR, probar empty→latest y upgrade representativo, aplicar en staging y observar. Production la ejecuta una identidad de deployment separada inmediatamente antes de la fase compatible de app, con registro y timeout controlado. Nunca DDL manual ad hoc ni editar migration aplicada.

## 42. Migration order

Cambios simples se ordenan según compatibilidad demostrada. Cambios complejos usan **expand → migrate/backfill → switch code → contract en release posterior**. La versión actualmente activa y la anterior deben tolerar la fase expand. Backend compatible se despliega antes que Web cuando el contrato lo requiera.

## 43. Migration locking

Toda migration revisa tamaño estimado, table rewrite, lock level/duration, index build y transaction behavior. En V1 tablas pequeñas no eliminan esta obligación. Operaciones de alto lock se separan, programan o usan mecanismos concurrentes compatibles; se prueban con dataset representativo.

## 44. Migration failure

Si falla, detener deploy antes de app incompatible, mantener/recuperar release anterior, marcar readiness según estado y alertar con release/request de deployment. Preservar logs/error, determinar si transaction hizo rollback completo y usar forward-fix o restore validado. Nunca continuar “a ver si funciona”.

## 45. Rollback application

El provider/pipeline debe permitir volver al artifact anterior conocido, restaurando config compatible y verificando health/smoke/metrics. Web y API pueden volver por separado si contratos lo permiten. Rollback no deshace database ni objetos; se evalúa compatibility primero.

## 46. Rollback database

No ejecutar down migration automática ciega. Preferir expand-contract y forward-fix. Si hubo corrupción/pérdida, restaurar PITR en instancia aislada, validar y planificar cutover/reconciliación; backup restore es operación de incidente con posible pérdida desde restore point.

## 47. Backups

Production PostgreSQL exige PITR/continuous recovery administrado, cifrado/provider access control y exports lógicos periódicos portables cuando costo/operación lo permitan. Object storage usa redundancia del proveedor, bucket privado y versioning/lifecycle para borrado accidental. Staging tiene backups proporcionales, sin mezclarlos con production.

## 48. Backup frequency

PITR es el mecanismo primario y debe cubrir un window mínimo contractual del plan; adicionalmente mantener snapshot/export lógico al menos semanal para portabilidad y antes de migrations de alto riesgo. Si PITR no está disponible económicamente, production readiness debe aceptar explícitamente un RPO peor; no asumir que backup diario es suficiente.

## 49. Restore testing

Obligatorio **trimestralmente**, antes del primer production launch y antes/después de cambios mayores de proveedor/backup. Registrar duración, restore point, checks, gaps y acciones. Un backup nuevo o política cambiada no se considera confiable hasta una prueba exitosa.

## 50. Restore environment

Restaurar a database/environment aislado sin tráfico production. Validar arranque, migrations/schema, roles/extensions/RLS, key record counts, Sales/Inventory/Reservation invariants, audit y acceso runtime. Destruir el restore de forma segura tras evidencia; nunca sobrescribir production para ensayar.

## 51. Object storage recovery

La DB contiene metadata/keys y storage los binarios; recovery valida ambos. Habilitar versioning o deletion recovery si el proveedor lo ofrece y definir lifecycle para versiones. Restore DB no recrea objetos eliminados: detectar referencias faltantes y recuperar desde versión/backup, sin borrar metadata silenciosamente.

## 52. RPO/RTO

Objetivos internos iniciales, no SLA contractual:

- **PostgreSQL RPO:** ≤15 minutos mediante PITR/continuous recovery.
- **Service RTO:** ≤4 horas para restaurar operación principal ante pérdida DB severa; rollback de app apunta a ≤1 hora.
- **Object storage:** no perder objetos por fallo único del proveedor; recuperación de borrado según versioning/window contratado.

Validar con restore drills y revisar antes de comercialización amplia.

## 53. Disaster scenarios

El plan cubre bad app deploy, DB outage, accidental deletion, corrupted migration, compromised credential, storage failure y provider outage. Cada uno define detección, contención, rollback/restore, verificación, comunicación/evidencia y post-review. No promete multi-region failover.

## 54. Bad application deploy

Detectar por health/Sentry/metrics, detener rollout, marcar release, volver al artifact anterior si schema es compatible, ejecutar smoke/invariants seleccionadas y monitorear. Luego reproducir, corregir y agregar regresión; no parchear archivos del servidor.

## 55. Bad migration

Detener writes/deploy si el impacto lo exige, preservar evidencia y determinar DDL/data changes. Si no hubo daño, forward-fix; si hubo pérdida/corrupción, PITR aislado, validación y cutover/reconciliación autorizada. No down/restore ciego ni reejecutar manualmente sin comprender estado.

## 56. Accidental business deletion

El dominio evita eliminación destructiva de Sales/audit/movements. Para datos eliminables, authorization, soft/archive semantics y audit reducen riesgo; PITR/versioning apoyan recovery. Backup no sustituye invariantes ni convierte SQL manual en workflow.

## 57. Database outage

Readiness falla y el provider deja de enviar tráfico; API retorna error seguro donde aún responde. Web muestra estado controlado y no persiste mutations para sincronizar después. No hay offline-first. Recuperar DB, verificar connections/RLS y reabrir tráfico gradualmente.

## 58. Provider outage

V1 acepta dependencia de managed providers. Monitorear status+uptime externo, comunicar, evitar writes inseguros y usar recovery soportado/testeado. Ante desastre prolongado, exports PostgreSQL/OCI/S3-compatible permiten migración planificada; no active-active multi-cloud.

## 59. Scaling API

Iniciar con una instancia dimensionada por load test. Escalar verticalmente si CPU/memory/pool lo justifican; luego réplicas stateless detrás del managed load balancer. Sessions/idempotency en PostgreSQL evitan sticky sessions. Verificar migrations, graceful shutdown y pool total antes de cada réplica.

## 60. API statelessness

Ningún durable business/session/idempotency/file state vive en memoria o filesystem local. Solo caches/request temporales prescindibles. Rate limiting local protege una instancia pero no es global; al escalar se activa su adapter compartido según SECURITY.

## 61. Scaling PostgreSQL

Primero medir/optimizar indexes, query plans, N+1, bounded pagination, pool y tamaño de instancia. No sharding, multi-primary ni read replicas por anticipación. Read replica futura solo para lectura demostrada y nunca para decisions que requieren estado consistente sin semántica explícita.

## 62. Connection pooling

Elegir pool directo o administrado compatible con Prisma, prepared statements y RLS transaction-local. Tenant context se establece con `set_config(..., true)` dentro de cada transaction y nunca en session persistente. Probar leakage con el modo real del proveedor. Registrar `DEP-DEC-005` subdecisión antes de production y dimensionar suma de pools de todas las réplicas.

## 63. RLS deployment validation

Migration/test de staging y gate production verifican policies/FORCE RLS esperados, runtime role sin owner/`BYPASSRLS`, contexto ausente fail-closed y no leakage por pool. Health público no revela resultados; falla deployment/readiness ante misconfiguración crítica.

## 64. Runtime DB role

API usa credencial restringida con DML mínimo y RLS. La identidad migration separada posee DDL solo durante deployment; admin/break-glass es tercera capacidad controlada. Runtime nunca usa owner/superuser/CREATE/ALTER ni contiene migration URL en Web.

## 65. Database network

Preferir private network API–DB en misma región/environment. Si DB pública es inevitable: TLS verificado, strong rotated credentials, allowlist/IP/private tunnel cuando viable y endpoint no expuesto innecesariamente. No desactivar certificate validation por conveniencia.

## 66. Deployment of Web and API

Deployables separados con matriz de compatibilidad N/N-1 durante rollout. Un release coordinado registra versiones Web/API; cualquiera puede revertirse si contrato permanece compatible. No forzar redeploy Web por cambio API interno ni acoplar availability de ambos artifacts.

## 67. API contract deployment

Evitar breaking changes V1. Para cambio compatible, desplegar backend capaz de servir Web actual y nueva, luego Web; retirar compatibilidad en release posterior. Cambios incompatibles requieren versionado/ADR y migration de consumidores, no ventana frágil de minutos.

## 68. Static assets caching

Assets Vite con hash usan `Cache-Control` largo/immutable. `index.html` y manifest/config shell usan no-cache/revalidation corta para descubrir nuevo release. Rollback restaura HTML que referencia assets aún disponibles; no borrar assets anteriores antes de ventana segura.

## 69. CDN

Usar CDN incluido en static host; no configurar CDN propio. Imágenes privadas solo pasan por signed authorization/storage o futura CDN privada con TTL/key rules revisadas. Cache nunca vuelve público un objeto tenant-owned.

## 70. File uploads

Flujo futuro autorizado: API autentica tenant/permission y emite operación/path acotado o recibe stream; browser sube sin credentials permanentes; backend valida metadata/MIME/size y persiste ownership. Signed URL corta no se loguea y bucket continúa privado. El flujo exacto se decide en implementación.

## 71. Maximum upload

Un único límite documentado debe alinearse entre proxy, API, signed policy y storage, más dimensiones/timeout. Hasta definir tamaño de producto no se fija número. El proxy no aceptará órdenes de magnitud mayores que application; cambios requieren security/load test.

## 72. Sentry deployment

Separar projects/environment tags Web/API/staging/production, asociar release+commit, configurar sampling/redaction y test sintético staging. DSN browser es configuración pública diseñada; auth token de source-map upload es secret CI. Production no recibe events locales/test.

## 73. Sentry source maps

Generar/upload privado durante build antes de error del release, validar, luego excluir/borrar `.map` del artifact público. Nunca exponer Sentry auth token. Rollback conserva artifacts/maps del release anterior durante retención diagnóstica.

## 74. Metrics provider

Inicialmente usar hosting + managed PostgreSQL + Sentry Performance limitado, conforme OBSERVABILITY. No Prometheus/Grafana propio. Reconsiderar ante métricas faltantes (pool/locks/RED), escala, alertas insuficientes, portabilidad o costo, mediante Architecture/Observability Review.

## 75. Uptime monitor

Monitor HTTPS externo para Web y API liveness/readiness, preferentemente fuera del mismo proveedor si costo razonable. Check no destructivo, historial y confirmación anti-flap. Marca/canal quedan `DEP-DEC-012 Pending` hasta seleccionar hosting.

## 76. Alerts

Canal inicial: email y notificación push/chat disponible de bajo costo; Critical debe llegar a una persona responsable. No PagerDuty V1. Alertas tienen owner, severidad, ventana y runbook; escalar canales cuando existan guardias/equipo.

## 77. Deployment notifications

Crear deployment marker en Sentry/log/hosting con release, environment y status; notificar failure y production success de forma agrupada. No enviar un mensaje por cada job interno ni incluir secrets/config.

## 78. Health checks deployment

Provider usa liveness/readiness según semántica definida. Ajustar interval/timeout/failure threshold después de medir startup y fallas para evitar restart loop por DB temporal. Readiness retira tráfico; liveness solo reinicia proceso realmente enfermo.

## 79. Graceful shutdown

En deploy, marcar not-ready, drenar requests, permitir transacciones acotadas, detener future jobs y cerrar HTTP/Prisma/storage. El timeout supera duración normal de operación crítica pero es finito. Provider debe enviar signal y respetar grace period; pruebas verifican conducta.

## 80. Zero-downtime aspiration

Apuntar a downtime mínimo mediante health, graceful replacement y backwards-compatible schema/contracts. No prometer zero downtime contractual; migrations excepcionales pueden requerir ventana planificada y comunicación.

## 81. Maintenance mode

No construirlo V1. Ante migration extraordinaria futura puede usarse capability del provider o respuesta read-only controlada, con Security/UX review. No mantener flag oculto sin tests.

## 82. Staging data

Factories/seed explícito crean datos sintéticos realistas, varias Organizations y escenarios Critical. No copia automática de production. Una necesidad excepcional exige anonimización irreversible, aprobación, acceso/retención acotados y revisión de privacidad.

## 83. Staging parity

Misma Node major, PostgreSQL major/extensions, migration path, container/build, auth/cookies/CSRF/RLS, object-storage semantics y observability config shape. Puede tener menor compute/retention, pero esas diferencias se documentan y load tests usan capacidad adecuada.

## 84. Preview environments

Adoptar **frontend previews por PR** si el static host los ofrece sin secrets sensibles. Backend+DB preview por PR se difiere por costo/aislamiento; component/API integration cubren PRs y staging cubre integración completa. Nunca conectar preview Web a production API.

## 85. Feature branches

Branches duran días, no meses, y se sincronizan con `main`. PR pequeño incluye docs/tests/migrations correspondientes. Borrar tras merge; no usarlas como entornos durables ni fuentes de release production.

## 86. Production access

Cuentas individuales, MFA cuando proveedor lo permita, least privilege y baja inmediata al cambiar responsabilidades. No credenciales compartidas. Separar deploy, billing, DB admin y observability permissions; revisar accesos periódicamente.

## 87. Database admin access

Acceso directo production es excepcional, temporal, autenticado y documentado; read-only por defecto para diagnóstico. Escrituras manuales requieren incidente/cambio autorizado, backup/rollback y audit externo. Nunca editar Sales/stock con SQL como operación normal.

## 88. Support access

Soporte no recibe acceso universal persistente. Herramientas futuras resuelven Organization/case con permission limitada, justificación, expiry y Audit. Logs se consultan por request ID sin revelar datos cross-tenant.

## 89. Production debugging

Prohibidos debug endpoints, remote debugger, stack traces públicas, shell permanente y log bodies. Diagnosticar con metrics/logs/Sentry/Audit y acceso break-glass controlado. No cambiar niveles DEBUG globales indefinidamente.

## 90. Prisma Studio

Solo local o environment aislado con datos sintéticos. Nunca público ni conectado a production como herramienta operativa. Diagnóstico production usa queries read-only aprobadas/provider tooling con role mínimo.

## 91. Database migrations authority

Solo CI/deployment identity dedicada ejecuta production migrations mediante job único y serializado. API runtime carece de DDL; humanos no usan admin URL en rutina. Emergency access es break-glass, registrado y revocado después.

## 92. Dependency install

CI/build usa versión fijada de pnpm y `pnpm install --frozen-lockfile`; production artifact no resuelve dependencias al iniciar. Cache acelera pero lockfile sigue autoridad. Una discrepancia manifest/lock falla el build.

## 93. Supply-chain controls

Revisar cambios de lockfile y install scripts, ejecutar vulnerability scan proporcional, minimizar dependencies, fijar third-party Actions por SHA y permisos del `GITHUB_TOKEN`. Usar OIDC hacia cloud donde exista; artifacts/provenance se evalúan antes de production. No ignorar Critical relevante ni bloquear por warning sin análisis.

## 94. Secret scanning

Habilitar GitHub secret scanning/push protection si plan/repositorio lo permite y un scan CI de patrones conocidos antes de production. Pre-commit es opcional. Ante hallazgo, rotar/revocar primero; borrar el commit no invalida el secret.

## 95. Environment promotion

Flujo: local → branch/PR checks → `main` → artifact build → staging deploy → migrations/smoke/E2E/observability → production approval → promotion → post-deploy verification. No saltar staging en auth, DB, security o cambios Critical.

## 96. Hotfixes

Branch corta desde `main`/release vigente, reproducción/regresión, PR y checks proporcionales; staging si el incidente lo permite, luego approval production. Reconciliar inmediatamente con `main`. No editar provider/server ni crear una rama permanente de producción.

## 97. Emergency deploy

Proceso abreviado solo para Critical: autorización explícita, tests mínimos seguros, backup/compatibility check, deployment registrado, monitoring inmediato y post-review obligatorio. Nunca omite secret/tenant/migration safety ni se vuelve camino normal.

## 98. Release checklist

- CI mandatory verde y artifact identificado.
- Migrations/locks/compatibility revisados.
- Staging deploy, smoke y Critical E2E exitosos.
- Security config/cookies/CORS/CSRF/RLS verificados.
- Secrets/environment completos sin exposición.
- Backup/PITR healthy y restore reciente según política.
- Sentry/metrics/uptime/alerts preparados.
- Rollback de Web/API y DB impact comprendidos.
- Known issues/risk/approval registrados.

## 99. Post-deploy checklist

Confirmar Web/API version, liveness/readiness, migration status, Sentry release/source maps, 5xx/latency/pool/slow queries, login y smoke read-only. Comparar before/after y observar ventana suficiente. Ante señal Critical, detener/rollback según runbook.

## 100. First production readiness

Antes del primer cliente: V1 requerido completo; security controls; tests Critical/cross-tenant/concurrency; load 10/20/40 con observabilidad; staging; PITR/backups y restore drill; domains/TLS/cookies; monitoring/alerts; incident contacts/runbooks; access review; release/post-deploy checklist aprobados.

## 101. Cost strategy

Elegir managed entry-level suficiente, con forecast mensual y límites/alerts. No sacrificar backups/PITR, security, staging o monitoring por ahorro marginal; tampoco pagar Kubernetes, multi-region, Redis, replicas o enterprise SIEM antes de evidencia.

## 102. Cost review triggers

Revisar al crecer Organizations/usuarios, compute/DB/storage/egress, log/Sentry volume, backup retention, CI minutes o necesidad de réplicas. También al cambiar pricing/region/provider. Documentar costo total y costo operacional, no solo precio de una instancia.

## 103. Scaling triggers

CPU, memory, event-loop/runtime, DB utilization/IO, pool waits, p95/p99, errors, locks, storage/egress y load test guían cambios. El número de clientes aislado no decide scaling. Optimizar cuello medido y verificar después.

## 104. Horizontal scaling readiness

API puede tener réplicas porque session/idempotency/durable state viven en PostgreSQL/storage. Antes: health/graceful shutdown, migrations single-run, total pool bounds, request IDs y load test. Rate limit persistente/shared se activa para consistencia global; no sticky sessions.

## 105. Redis trigger

**Redis no V1.** Reconsiderar por distributed rate limiting al escalar réplicas, cache de alto valor medida, queue/backend real o coordinación que PostgreSQL no resuelva adecuadamente. No usarlo por cantidad arbitraria de usuarios ni como segundo source of truth.

## 106. Worker trigger

**Sin workers/broker inicialmente.** Introducir por email robusto, exports grandes, integraciones, scheduled processing o tareas que excedan HTTP/timeouts. Requiere job persistence, idempotency, retries/dead-letter, observability, deployment y runbook; no ejecutar trabajo pesado indefinido en request.

## 107. Disaster recovery document

Runbooks conceptuales V1: API rollback (45/54), DB restore (109), compromised secret (108), storage issue (51) y provider outage (110). Al elegir proveedor, convertirlos en pasos/comandos verificados con owners/contactos y guardar fuera de la única plataforma que podría fallar.

## 108. Compromised secret

Revocar/rotar, detener acceso afectado, identificar scope/ventana por logs, actualizar secret manager y redeploy artifact/config sin revelar valor, verificar sesiones/integraciones y revisar incidente. Rotar dependencias encadenadas y no confiar en borrar Git history como solución.

## 109. Database restore runbook

1. Declarar incidente y elegir restore point/RPO.
2. Crear restore aislado con identidad admin controlada.
3. Validar schema, roles/RLS, records e invariantes.
4. Elegir PITR cutover, forward-fix o reconciliación.
5. Restringir writes durante switch si hace falta.
6. Cambiar credencial/endpoint de forma segura.
7. Ejecutar health/smoke/consistency y observar.
8. Documentar pérdida real, tiempos y follow-up.

No se incluyen comandos específicos antes de proveedor.

## 110. Provider outage runbook

Confirmar con uptime/status, evaluar alcance, pausar operations/writes inseguros, comunicar internamente y mantener evidencia. Usar failover solo si proveedor lo ofrece y fue probado; si el desastre excede tolerancia, restaurar exports/backups en alternativa compatible mediante plan aprobado. No improvisar multi-cloud.

## 111. Data export portability

Mantener migrations/SQL/Prisma versionados, exports PostgreSQL estándar, OCI image y objetos descargables/S3-compatible. Evitar funciones propietarias esenciales sin exit plan. Probar export/restore, no asumir portabilidad solo por usar PostgreSQL.

## 112. Compliance posture

No declarar certificaciones ni SLA. Mantener least privilege, MFA, encryption/TLS, backups/restore, audit, privacy, incident evidence y access reviews. Requisitos legales, residencia o compliance se evalúan con asesoramiento según mercado/jurisdicción.

## 113. Documentation

README futuro contiene setup local y comandos; este documento conserva decisiones/flows/checklists. Runbooks provider-specific podrán vivir en `docs/runbooks/` cuando exista proveedor y operación real. Toda instrucción incluye environment y evita secrets.

## 114. AI/Codex deployment rules

Codex no debe inventar/imprimir secrets, cambiar production config sin tarea, ejecutar migration destructiva, añadir proveedor/Docker/Kubernetes/Redis por defecto, alterar CI global en feature ajena, deshabilitar checks o omitir rollback. Debe preservar environment isolation, inspeccionar estado real, reportar cambios y detenerse en alcance.

## 115. AI infrastructure review

Antes de cambio sensible, Codex informa environments, identities/secrets requeridos (solo nombres), migrations/locks, downtime, rollback/restore, observability, costo y verificación. Acciones externas o destructivas requieren autoridad explícita y nunca se ejecutan silenciosamente.

## 116. Deployment anti-patterns

- `git pull`/edición manual production.
- DB o secrets compartidos entre dev/prod.
- Secrets en Git/image/frontend/docs.
- API usando DB owner/admin.
- Migration aplicada editada o DDL ad hoc.
- Sin staging/restore tests/rollback.
- Docker Compose en production o Kubernetes sin necesidad.
- PostgreSQL/bucket públicos sin controles.
- Source maps públicas accidentalmente.
- Rebuild distinto por environment.
- Force push de historial production.
- Production usada como test.
- Releases enormes por un proceso que genera miedo al deploy.

## 117. Provider decision register

| ID | Decisión | Estado | Trigger/criterio |
|---|---|---|---|
| DEP-DEC-001 | pnpm workspaces | **Accepted** | Revisión solo por incompatibilidad demostrada. |
| DEP-DEC-002 | GitHub Actions | **Accepted** | Revisión por limitación/costo/seguridad real. |
| DEP-DEC-003 | Managed Node/OCI API hosting | **Category Accepted; Provider Pending** | Benchmark región, health, private DB, rollback, logs y precio. |
| DEP-DEC-004 | Managed static CDN hosting | **Category Accepted; Provider Pending** | SPA fallback, headers/cache, domain, preview, rollback/costo. |
| DEP-DEC-005 | Managed PostgreSQL + PITR | **Category Accepted; Provider Pending** | Región común, Prisma/RLS/pool, PITR/restore, metrics/costo. |
| DEP-DEC-006 | Private S3-compatible storage | **Category Accepted; Provider Pending** | Region/egress, signed URLs, versioning/lifecycle/recovery. |
| DEP-DEC-007 | API/DB colocadas cerca de Argentina | **Pending** | Medición de latencia y disponibilidad real al contratar. |
| DEP-DEC-008 | Same-site Web/API subdomains | **Accepted** | Dominio concreto Pending; cambio cross-site requiere Security Review. |
| DEP-DEC-009 | API container-first; Web static | **Accepted** | Native build permitido solo con artifact equivalente. |
| DEP-DEC-010 | IaC deferred | **Accepted** | Drift, múltiples recursos/operadores o compliance. |
| DEP-DEC-011 | Production PITR + quarterly restore | **Accepted; Plan Pending** | Confirmar window/precio y RPO/RTO con proveedor. |
| DEP-DEC-012 | Managed metrics + external uptime | **Category Accepted; Provider Pending** | Selección junto al hosting y canales. |
| DEP-DEC-013 | Manual production approval | **Accepted** | Automatización solo con madurez/evidencia. |
| DEP-DEC-014 | Main + short-lived PR branches | **Accepted** | Revisión si escala equipo/release process. |

## 118. Suggested V1 baseline

Se acepta con matices: pnpm workspace; GitHub Actions; static managed Web; managed/containerized Node API; managed PostgreSQL con PITR; private S3-compatible storage; Sentry; provider metrics; external uptime; staging+production; manual production approval; short-lived branches. No se adopta una marca única hasta comprobar región/latencia, backup, networking y costo.

## 119. Implementation roadmap dependencies

- **Repository bootstrap:** Node/pnpm/workspace/lockfile y comandos.
- **CI:** GitHub Actions, permissions, test/build artifacts y environments.
- **Environment validation:** schemas y secret inventory.
- **Database bootstrap:** managed PG, roles, RLS, pool, migrations, PITR.
- **Object storage:** buckets, CORS/signed flow, lifecycle/versioning.
- **Staging:** domains/TLS/cookies, synthetic data, deploy/smoke/E2E/load.
- **First production deploy:** provider/region contracts, restore drill, monitoring, approval/runbooks.

Cada tarea debe cerrar DEP-DEC Pending que realmente necesite, con evidencia vigente.

## 120. Deployment Definition of Done

Un cambio deployable demuestra según riesgo: build frozen/reproducible; CI verde; config validada; migrations compatible y revisada; staging/smoke/E2E exitosos; observability/release marker; rollback y DB impact comprendidos; ningún secret expuesto; approval y post-deploy health. Una excepción queda documentada con owner/expiry.

## Required decision verification

- Entornos: local, test, staging y production aislados.
- Package manager/runtime: pnpm workspaces; Node 24 LTS fijado; PostgreSQL major soportada común.
- Delivery: short-lived PRs, GitHub Actions, staging automático y production approval manual.
- Builds: Web static y API OCI/build separados, artifacts inmutables.
- Hosting: static CDN + managed API + managed PostgreSQL/PITR + private object storage.
- Security: same-site subdomains, HTTPS, cookies host-only, strict CORS/CSRF y secret manager.
- Data: reviewed migrations, expand-contract, forward-fix, PITR y restore trimestral.
- Recovery: app rollback, DB restore aislado, RPO ≤15 min y RTO ≤4 h internos.
- Operations: Sentry, provider metrics, uptime externo y checklists.
- Scaling: vertical primero, replicas stateless medidas; sin Kubernetes/Redis/workers V1.
- Versioning: SemVer 0.x + commit SHA/build ID.

## Review flags

No se encontraron contradicciones:

- `Architecture Review Required`: No.
- `Database Review Required`: No.
- `Security Review Required`: No.
- `Testing Review Required`: No.
- `Observability Review Required`: No.

Cross-site cookies, OTel/Prometheus, multi-region, DB provider incompatible con RLS/pool o cambio de RPO/RTO requiere la revisión correspondiente.

## Final review

Se verificaron arquitectura, RLS/roles/pooling, seguridad, cookies/CSRF/CORS, test/load 10–40, observabilidad, migration locks/compatibility, backups/PITR/restore, rollback, GitHub security, costos y crecimiento. La estrategia soporta V1 sin Kubernetes, Redis, workers, multi-cloud ni IaC prematuro, y conserva una ruta medida hacia réplicas y automatización.

## Technical references

- Node.js release schedule and LTS policy.
- pnpm workspace and frozen-install documentation.
- GitHub Actions environments, deployment protections and security guidance.
- PostgreSQL versioning/support policy.
- Official Render, Railway, Fly.io, Neon and Supabase capability documentation consulted as candidate evidence; pricing and availability require revalidation at selection time.
