# BCM SOFT — Observability Strategy

Propósito: definir cómo diagnosticar, medir y operar BCM SOFT en local, test, staging y producción con observabilidad proporcional a V1.

Estado: `Completed`.

Alcance: decisiones documentales para futuras implementaciones. Esta fase no instala SDKs, configura proveedores, dashboards, alertas ni CI/CD.

## 1. Observability principles

1. Los logs son estructurados.
2. Los errores deben ser accionables.
3. Toda request debe poder correlacionarse.
4. Las métricas responden preguntas operativas concretas.
5. El tracing se incorpora proporcionalmente.
6. Los datos sensibles se minimizan y redactan.
7. Audit Records y logs técnicos tienen propósitos distintos.
8. Health no revela internals.
9. Se mide antes de optimizar.
10. Producción debe diagnosticarse sin debugger.
11. La instrumentación no debe degradar materialmente el servicio.
12. No se recopila telemetría sin uso operacional definido.

## 2. Three pillars

- **Logs:** eventos discretos con contexto para reconstruir una ejecución. Obligatorios y centralizados en V1.
- **Metrics:** series agregadas para tráfico, errores, latencia y saturación. Obligatorias mediante capacidades administradas y unas pocas métricas application.
- **Traces:** relación temporal entre pasos de una operación. V1 mantiene trazas básicas HTTP/DB/storage a través de performance tracking limitado y correlación; OpenTelemetry/distributed tracing completo se difiere.

Ningún pilar sustituye Audit o el estado comercial en PostgreSQL.

## 3. V1 observability scope

V1 exige logs backend JSON centralizados, Sentry/equivalente para Web y API, request IDs, liveness/readiness, métricas RED de API, visibilidad de DB/pool/slow queries, versión/release, uptime externo y alertas mínimas. Se instrumentan operaciones críticas seleccionadas. No se opera Prometheus/Grafana ni un collector/tracing distribuido propio.

## 4. Request ID

Cada request obtiene un UUID aleatorio —preferentemente UUIDv7 o UUIDv4 según utilidad común disponible— sin datos codificados. Solo se acepta un header entrante desde un proxy confiable y tras validar formato/longitud; en otro caso la API reemplaza el valor. Se propaga por contexto async, se devuelve en un header estable y en errores JSON, y aparece en logs/error tracking/audit. No autentica ni autoriza.

## 5. Correlation

El request ID vincula request HTTP, operación application, tiempos DB, error event y Audit Record. Un proveedor puede generar trace/event IDs propios; se almacenan como mapping junto a `requestId`, no se obliga a reemplazarlos. En jobs futuros, un correlation ID de origen y un job ID continúan la cadena.

## 6. User context in logs

Tras validar sesión pueden incluirse `userId`, `organizationId`, `membershipId` y un identificador interno/hash no reversible de sesión cuando sea necesario. Nunca email por defecto, Customer PII, password, cookie ni session/recovery/invitation/CSRF token. El contexto se agrega en el boundary una vez, no manualmente en cada capa.

## 7. Organization context

Operaciones tenant-owned incluyen el UUID interno de Organization en logs seguros para filtrar incidentes, queries lentas y denegaciones. No usar nombre comercial cuando el ID alcance. En métricas no se usa `organizationId` como label por defecto debido a cardinalidad y privacidad.

## 8. Structured logging

Producción emite JSON newline-delimited con allowlist baseline: `timestamp`, `level`, `service`, `environment`, `version`, `requestId`, `event`, `route`, `method`, `statusCode`, `durationMs`, y opcionalmente IDs internos y `errorCode`. Mensajes humanos complementan campos, nunca son la única estructura. Timestamps son UTC.

## 9. Log levels

- **DEBUG:** diagnóstico temporal, desactivado en producción salvo ventana autorizada y acotada.
- **INFO:** startup/shutdown, request completada y operación relevante exitosa.
- **WARN:** situación inesperada recuperable, conflicto/spike cuando merece atención o retry.
- **ERROR:** fallo inesperado, agotamiento de retries o dependencia indisponible que requiere investigación.

No registrar cada query normal como INFO ni convertir errores de negocio esperados en ERROR.

## 10. Log events

Usar nombres estables en `lowercase.dot.notation`, como `request.completed`, `request.failed`, `sale.confirmed`, `sale.confirmation_failed`, `database.slow_query`, `auth.login_failed` y `auth.session_revoked`. Definir owner y significado; cambios incompatibles se revisan. El payload técnico no replica before/after completo de Audit.

## 11. PII and sensitive data

Redacción denylist central más allowlist por evento. Nunca passwords/hashes, tokens, Authorization, cookies, CSRF, DB/storage URLs/credentials, secret keys, signed URLs completas o futuro payment-sensitive data. Email, teléfono, IP, user-agent, Customer name y notas se excluyen, reducen o hashean solo ante necesidad documentada.

## 12. Free-text fields

`observations`, `notes`, `reasons` y cualquier texto libre no se serializan automáticamente. Un evento técnico usa código/categoría o longitud, no contenido. Audit puede guardar un reason permitido por su política; esa excepción no habilita copiarlo a logs o error tracking.

## 13. Error tracking

Se recomienda **Sentry administrado** —o equivalente con capacidades comparables— para V1, con proyectos separados Web/API y environments. Debe ofrecer agrupación, releases, source maps, breadcrumbs controlados, backend/frontend errors y performance sampling limitado. La configuración concreta pertenece a implementación/deployment.

## 14. Error grouping

Agrupar por stack/fingerprint estable y contexto de error, evitando un issue por occurrence o por request ID. Conservar first/last seen, frecuencia, release y environment. Fingerprints manuales solo corrigen grouping inadecuado; no fusionan causas distintas para reducir ruido.

## 15. Error context

Enviar `requestId`, route template, release/environment, `organizationId` y `userId` internos solo si aportan investigación y pasan política. No bodies completos, headers, cookies, SQL parameters o información financiera. Tags son de cardinalidad acotada; IDs individuales se guardan como contexto buscable solo si proveedor/costo/privacidad lo permiten.

## 16. Frontend errors

Capturar uncaught exceptions, unhandled promise rejections, React error boundaries y network failures inesperadas seleccionadas. 400/401/403/404/409/429 esperados no son exceptions críticas; spikes se observan agregadamente. Limpiar breadcrumbs de click/input, URLs y fetch para no enviar datos sensibles.

## 17. Backend errors

Capturar unhandled exceptions, infrastructure errors, Prisma/PostgreSQL inesperados, transaction failure, deadlock/retry exhaustion y domain failures que deberían ser imposibles. Validation, authorization y conflicts esperados se registran/metrican según contexto sin exception spam. Preservar `cause` internamente y respuesta pública segura.

## 18. Error classification

| Clase | Ejemplos | Tratamiento |
|---|---|---|
| Expected operational | validation, auth denial, not found tenant-safe, conflict | Respuesta estable; métrica/log agregado; sin alerta individual. |
| Unexpected application | bug, invariant impossible, unhandled | ERROR + error tracking + requestId. |
| Infrastructure | DB/storage/network unavailable, retry exhausted | ERROR + tracking/metric; alerta según impacto. |

Un 400 no recibe la misma severidad que un 500.

## 19. API metrics

Aplicar RED: request count, duration y error distribution. Segmentar por `service`, `environment`, `method`, route template y status class/código acotado. Medir in-flight requests o saturación si el hosting no lo aporta. Nunca usar IDs de recurso en labels.

## 20. Route labels

Normalizar con el template conocido por el router (`/sales/:id`), no `req.url` ni `/sales/<uuid>`. Rutas desconocidas agrupan como patrón controlado, evitando cardinalidad por probes o query params.

## 21. Latency

Observar histogramas y p50/p95/p99 por route template/method en ventanas suficientes; el promedio solo complementa. Separar network/browser timing de server duration y distinguir background refetch de acciones críticas cuando sea posible.

## 22. Initial latency expectations

Budgets diagnósticos iniciales en staging con dataset representativo: fast reads p95 alrededor de 500 ms, standard mutations p95 alrededor de 1 s y reports futuros p95 alrededor de 3 s. No son SLA contractuales; excluyen red del usuario y se recalibran con baseline, complejidad y Production Readiness. Una excepción sostenida exige explicación/plan.

## 23. Error rate

Medir 5xx por route/status, 429, auth failures y denials seleccionados. La tasa de sistema usa 5xx/requests elegibles, no todos los 4xx. Spikes de 401/403/404/409 pueden alimentar seguridad o producto sin inflar availability errors.

## 24. Database observability

Observar query duration/nombre, slow queries, pool active/idle/waiting, acquisition time/timeouts, transaction failures, deadlocks y lock waits cuando proveedor/PostgreSQL lo permitan. Usar métricas del PostgreSQL administrado y application instrumentation. Nunca registrar bind parameters sensibles ni connection strings.

## 25. Slow query threshold

Configurar `slow query` inicialmente en **250 ms** por operación DB en staging/production, no hardcodeado en módulos. Revisarlo tras load tests y baseline. El evento incluye query/operation name, duration, module, requestId y Organization ID cuando sea seguro; no SQL completo ni params por defecto. Thresholds específicos requieren evidencia.

## 26. Query naming

Nombrar consultas críticas/complejas de forma lógica: `inventory.search`, `sale.confirm.lock_equipment`, `dashboard.monthly_summary`. El nombre es estable y de baja cardinalidad; ayuda a comparar sin depender del SQL generado.

## 27. Prisma observability

Instrumentar Prisma mediante eventos/extensión compatible para timings agregados y errores, con logging query detallado opt-in solo local/staging controlado. Producción no imprime todas las queries ni params. Correlacionar al contexto de request y sanitizar mensajes/códigos antes de enviarlos.

## 28. Connection pool

Monitorear conexiones active/idle, waiters, acquisition latency, timeouts y exhaustion desde runtime/proveedor. Correlacionar saturación con API latency y DB load. Es un foco explícito de las pruebas de 10/20/40 usuarios y de readiness sin convertir readiness en un load test.

## 29. Transaction metrics

Para confirm/cancel Sale, Reservation, Trade-In, inventory adjustment e idempotency medir duración, success/rollback, conflicts, deadlocks y retries agotados mediante nombres acotados. No label por Sale/User. Un rollback de negocio esperado no equivale automáticamente a incidente.

## 30. Business operation metrics

Métricas operativas permitidas: `sale.confirm.success/conflict`, `reservation.conflict`, `stock.adjust.failure` e `idempotency.replay`. Sirven para salud y anomalías, no reporting comercial ni facturación. PostgreSQL continúa como source of truth de ventas, stock y rentabilidad.

## 31. Idempotency observability

Emitir outcome acotado: `first_execution`, `valid_replay`, `incompatible_key`, `concurrent_duplicate`. La key no se registra completa; usar hash corto no reversible o solo el ID interno del registro cuando investigar lo exija. Conservar operation y tenant context seguro.

## 32. Concurrency observability

Registrar/medir duplicate Sale prevented, Reservation conflict, lock timeout/deadlock, stock insufficient bajo carrera y retry exhaustion. Conflictos legítimos son comportamiento esperado; se alertan solo por tasa anormal, impacto o invariant failure.

## 33. RLS observability

`missing_tenant_context`, policy denial inesperado y runtime role inválido son eventos relevantes. La ausencia de contexto en operación tenant-owned es ERROR y puede alertar por repetición; una denegación esperada es WARN/seguridad agregada. No incluir fila ni dato del otro tenant.

## 34. Authentication metrics

Contar login success/failure, session expired/revoked, rate limits y recovery request/result genérico por environment/route/outcome. No etiquetar email, account, IP o session. Logs individuales limitados pueden usar fingerprint seguro bajo retención y acceso restringidos.

## 35. Authorization metrics

Contar denials por permission code allowlisted, route template y environment; no `userId`/`organizationId` como labels. Alertar solo por picos, patrones cross-tenant o acciones administrativas sensibles, no por cada 403 legítimo.

## 36. File observability

Registrar/medir upload success/failure, type/size rejection, storage errors, signed URL authorization failure y delete inconsistency. No guardar contenido, nombre libre sin sanitizar, object key sensible ni signed URL completa.

## 37. Frontend performance

V1 usa navigation/API timings básicos y performance spans muestreados si Sentry lo permite sin SDK adicional. Agrupar por route template/release/device class general, no usuario. Diagnosticar waterfalls, errores de carga y regresiones; no construir analytics de marketing.

## 38. Web Vitals

Decisión V1: **medir LCP, INP y CLS en staging y habilitar muestreo bajo en producción solo si la integración elegida los ofrece con costo/privacidad aceptables**. No son gate de lanzamiento ni KPI comercial; establecer baseline y revisar p75 mobile/desktop antes de fijar budgets propios.

## 39. Health checks

Separar endpoints/semánticas de **liveness** (proceso vivo) y **readiness** (instancia apta para tráfico). Orquestador/hosting usa cada señal para una decisión distinta; ninguna expone diagnóstico detallado públicamente.

## 40. Liveness

Comprueba proceso/event loop y estado fatal interno sin consultar PostgreSQL, storage u otros servicios. Debe ser barata, sin mutation y seguir respondiendo durante una caída de dependencia para evitar restart loops inútiles.

## 41. Readiness

Comprueba estado de draining y conectividad PostgreSQL mediante operación liviana con timeout. Falla si la API no puede atender correctamente. Responde solo status/código; no host, credentials, SQL, pool internals o topología.

## 42. Object storage health

No consultar storage en cada readiness general. Usar métricas del proveedor, health protegido bajo demanda o synthetic no destructivo separado. Solo volverlo dependencia de readiness si toda función esencial de la instancia realmente lo requiere y se revisa riesgo de falsos negativos.

## 43. Health endpoint security

Un endpoint público devuelve como máximo estado genérico y status HTTP. Diagnóstico de componentes, version, latencia y causas vive en plataforma restringida. Aplicar rate/timeout razonable y no revelar packages, hosts, DB names o environment secrets.

## 44. Uptime monitoring

Producción usa monitor externo administrado o capacidad equivalente del proveedor para Web reachable y API liveness/readiness desde fuera del deployment. Ejecutar desde al menos una ubicación razonable, con confirmación/reintento corto antes de alertar para reducir ruido. No desarrollar un monitor propio.

## 45. Synthetic monitoring

V1 no exige más que health/uptime. Futuro synthetic puede validar login con cuenta dedicada y lectura autenticada no sensible, con secrets aislados. Nunca crea Customer, Reservation o Sale real ni modifica stock.

## 46. Deployment markers

Cada Web/API deploy publica y registra `version`, commit SHA, release/build ID y timestamp coordinado. Logs, Sentry y dashboards permiten filtrar por release; un evento `deployment.completed`/marker separa before/after. El mismo artefacto conserva ID al promoverse.

## 47. Version endpoint

Decisión: endpoint interno/restringido o metadata del proveedor, no público detallado. Expone solo service, release/build ID y build time necesarios para soporte; no dependency versions, commit branch, configuración ni infraestructura. Public health no incluye versión.

## 48. Environment tags

Toda telemetría incluye exactamente uno de `local`, `test`, `staging`, `production`; service y release también son dimensiones base. Proyectos/dashboards/alertas separan production de no-production y jamás notifican con igual severidad por un error local.

## 49. Staging observability

Staging replica campos, redaction, health, error tracking, metrics y release markers de producción para probar migrations, RLS y carga. Puede usar menor retención/sampling y destinos separados. Un error sintético valida la ruta antes del release.

## 50. Local development

Local permite pretty output derivado del mismo evento estructurado y nivel DEBUG opt-in. Mantener nombres/campos/redaction iguales a producción; no cambiar reglas funcionales. Prisma query debug se habilita conscientemente y nunca muestra secrets en repositorios o tickets.

## 51. Log retention

Objetivo inicial sujeto al proveedor: production 30 días de búsqueda operativa; staging 7–14 días; test solo artifacts de fallos por pocos días; local efímero. Incidentes pueden preservar un subconjunto bajo control de acceso. Revisar costo, privacidad y necesidad antes de ampliar; nunca retención indefinida por defecto.

## 52. Error retention

Sentry debe conservar historia suficiente para comparar releases; objetivo inicial 90 días si plan/costo lo permite, con issues críticos preservados mediante export/evidencia controlada. La selección final y quotas se resuelven en deployment/procurement.

## 53. Audit retention

Audit Records son datos tenant-owned de negocio/seguridad con política, acceso e integridad propios. No se eliminan por rotación de logs/Sentry ni se usan como fuente de métricas técnicas. Retención legal/comercial se decide por separado.

## 54. Alerting philosophy

Cada alerta debe ser accionable, tener owner/canal, severidad, ventana, impacto posible, enlaces de diagnóstico y primer paso/runbook. Usar ventanas sostenidas y agrupación para evitar alert fatigue. Si nadie puede actuar, convertirla en dashboard o eliminarla.

## 55. Initial alerts

Baseline reducido: Web/API unavailable; DB unavailable; 5xx elevado sostenido; error spike posterior a deploy; p95 persistentemente degradado; pool waiting/exhaustion; retries/deadlocks críticos agotados; RLS missing-context repetido. Background mechanism se agrega solo cuando exista.

## 56. Alert severity

- **Critical:** producción no disponible, sospecha de fuga tenant, pérdida/corrupción de datos o transacción crítica sistémicamente rota; respuesta inmediata.
- **High:** degradación significativa, 5xx/login outage parcial, DB/pool cercano al agotamiento; atención prioritaria.
- **Warning/Medium:** slow-query/performance regression o patrón anómalo sin impacto grave; revisar en horario operativo.

La severidad considera alcance, duración y recoverability, no solo tipo de evento.

## 57. Security alerts

Considerar brute-force/rate-limit spike, cross-tenant probing repetido, cambios admin inusuales, secret scan failure y missing RLS context. Agregar conteos y ventanas; no convertir cada login fallido o 403 en incidente. Audit y logs preservan el detalle autorizado.

## 58. Tenant leak suspicion

Tratar cualquier indicio de acceso cross-tenant como Critical: contener acceso/deploy afectado, preservar logs/audit/release, identificar Organizations/recursos y ventana temporal sin ampliar exposición, investigar, corregir/revocar, verificar y documentar. Notificaciones legales/comerciales requieren política/asesoría aplicable, no se improvisan.

## 59. Dashboards

Solo tres vistas V1:

- **API Health:** traffic, 5xx/error, p50/p95/p99 y deployments.
- **Database:** connections/pool, latency/slow operations, errors/deadlocks/locks.
- **Security/Auth:** login failures, rate limits, denials y RLS context failures.

No dashboard por módulo ni analytics de ventas en observabilidad.

## 60. High-cardinality labels

Prohibidos en metrics: `userId`, `organizationId` por defecto, Customer/Equipment/Sale/File IDs, raw URL, requestId, IP, email y error message libre. Usar route template, method, status class, operation code, environment, service y release controlado. IDs viven en logs/contexto con acceso y retención adecuados.

## 61. Sampling

Con volumen inicial bajo, conservar INFO/WARN/ERROR ampliamente y nunca samplear indiscriminadamente Critical errors o incident evidence. Performance traces/browser events usan sampling configurable por environment y route; comenzar bajo en producción y mayor en staging. Adaptar por costo y utilidad, no ocultar fallas.

## 62. Tracing strategy

Decisión: **OpenTelemetry Deferred but architecture-ready**. V1 satisface trazas básicas con request context, timings HTTP/DB/storage y Sentry Performance muestreado; no despliega OTel SDK/Collector ni distributed tracing completo para un monolito con pocas dependencias. Mantener nombres y context propagation compatibles para adoptar OTel cuando haya múltiples servicios, integraciones o diagnóstico insuficiente.

## 63. Internal spans

Si se habilitan spans, limitar a inbound HTTP, use case crítico, DB operation nombrada y external storage call. Incluir status/duration y atributos de baja cardinalidad. No crear span por función, mapper, repository method trivial o fila.

## 64. Trace propagation

Futuras integraciones pueden propagar W3C Trace Context a destinos allowlisted. IDs externos se validan/delegan al SDK, no se usan como requestId, authorization ni label libre. No reenviar baggage con PII/tenant secrets.

## 65. Audit correlation

Toda acción sensible puede persistir `correlationId/requestId` en Audit Record para navegar Audit → request técnico. El audit conserva actor, objeto y razón; los logs conservan ejecución. La ausencia/rotación de logs no debe impedir comprender el hecho comercial.

## 66. Audit failures

Cuando Audit prueba el mismo hecho sensible, se escribe en la transacción definida por BACKEND_STANDARDS. Si persistence falla, la operación completa falla y hace rollback; emitir error técnico sanitizado fuera/tras la transacción cuando sea posible sin afirmar éxito. No continuar silenciosamente ni crear audit diferido no autorizado.

## 67. Monitoring money correctness

Observar anomalías técnicas: intento de stock negativo, invalid exchange rate rechazado, WAC failure, snapshot requerido ausente o decimal serialization failure. No enviar importes completos salvo necesidad específica y no recalcular contabilidad desde métricas/logs.

## 68. Data quality checks

Constraints y tests son defensa primaria. Consultas read-only futuras podrían detectar Sold Equipment sin Sale, stock negativo, Active Reservation + Sold contradiction u orphan Trade-In. Solo se justifican con riesgo/evidencia, dataset bounded y owner; un hallazgo alerta y abre investigación, no corrige automáticamente.

## 69. Scheduled integrity checks

Diferidos para V1 mientras constraints/tests cubran invariantes. Si se agregan serán read-only, tenant-safe, idempotentes, observables y ejecutados con rol mínimo. Nunca mutan datos para “reparar” sin política, audit y operación autorizada.

## 70. Application startup observability

Registrar una vez service, release, environment, startup initiated/succeeded, config validation success y compatibilidad de migration/schema cuando exista mecanismo seguro. No imprimir valores de configuración, DSN, hosts sensibles o secrets.

## 71. Startup failure

Configuración inválida, migration incompatible o dependencia esencial no inicializable produce fail-fast. Registrar código/causa sanitizada y release; enviar error tracking solo si SDK está disponible sin ocultar exit. No aceptar tráfico parcialmente inicializado.

## 72. Graceful shutdown observability

Eventos: `shutdown.initiated`, `shutdown.draining`, adapters/DB close, `shutdown.completed` o timeout/failure. Marcar not-ready primero y medir duración. No registrar cada connection ni prolongar indefinidamente el proceso.

## 73. Frontend release version

El build Web incluye un release/build ID no secreto usado por Sentry, logs de deploy y soporte. Puede diferir del API release pero un deployment coordinado registra ambos. No es security control ni habilita features.

## 74. Source maps

Generar source maps de producción y subirlos al error tracker durante build/release autenticado; validar asociación antes de deploy. No publicarlos con assets: usar hidden/no-reference y excluir o borrar `.map` del artefacto servido tras upload. El token de upload vive en secrets de CI y nunca en bundle/repositorio.

## 75. Browser console

Console no es observabilidad productiva. Eliminar debug logs y respuestas completas antes de release. Errores esperados se presentan en UI; inesperados llegan a error tracking sanitizado. Nunca imprimir auth/session, Customer data, financial fields o API bodies.

## 76. Support diagnostics

Soporte puede solicitar request ID, timestamp aproximado, sale number público y Organization identifier interno obtenido por canal autorizado. No pedir cookies/tokens, HAR sin sanitización o screenshots con secretos. Acceso a logs/audit sigue least privilege.

## 77. User-facing error IDs

Decisión: para error inesperado la UI muestra mensaje seguro y `Reference: <requestId>`. Para validation/conflict presenta instrucción funcional y puede ocultar la referencia salvo soporte. El ID no expone causa, identidad o tenant y permite correlación.

## 78. Privacy

Aplicar data minimization, purpose limitation, acceso por environment/role, retención finita y revisión de proveedores/región antes de producción. Cada nuevo campo responde por qué se necesita y quién lo usa. Incluir redaction tests y revisión de sample events reales de staging.

## 79. Logging free-form objects

Prohibido `logger.info(req.body)`, spreads de DTO/request, Error sin sanitizer o objetos externos arbitrarios. Construir un objeto allowlisted con nombres/controlados; normalizar CR/LF y límites para evitar log injection y payloads gigantes.

## 80. Financial data logs

Normalmente registrar Sale ID, operation y outcome, no prices, costs, margins, payments o exchange rates. Valores necesarios para Audit comercial permanecen allí con permission/retention propia. Nunca usar logs como export financiero.

## 81. Performance budget concept

Budgets suaves: requests por pantalla bounded y sin duplicación, payloads paginados/razonables, query count estable, y ningún endpoint administrativo de varios segundos sin clasificación/feedback. Los números de la sección 22 son baseline diagnóstico; BCM-010/Production Readiness valida capacidades del hosting y objetivos definitivos.

## 82. N+1 observability

Tests/review/query design son primera defensa. V1 observa endpoint/query duration y, si la instrumentación lo ofrece barato, query count agregado por request. Repeated query patterns en staging pueden diagnosticar N+1; no guardar SQL/params ni construir detector propio.

## 83. Cache observability

No hay cache distribuida V1. TanStack Query es client cache y sus fallos se observan mediante UX/network errors, no métricas backend de hit rate. Si se agrega cache server futura, medir hit/miss, latency, stale/error y eviction antes de depender de ella.

## 84. Background jobs observability

No existen workers/broker V1. Toda incorporación exige job ID, correlation/origin, attempts, duration, success/failure, idempotency y dead-letter/failure visibility, además de health/alert owner. No diseñar esa plataforma ahora.

## 85. Object storage metrics

Usar métricas administradas para upload latency, operations y errors cuando estén disponibles; agregar instrumentation application solo para gaps críticos. Segmentar por operation/outcome, no object key o filename. Evitar colector custom.

## 86. Dependency health

Toda dependencia futura define timeout, error/latency metrics y degradación esperada. Readiness solo la incluye si es esencial. Circuit breaker se evalúa con fallos reales, no se implementa preventivamente.

## 87. Observability ownership

| Señal | Owner de emisión |
|---|---|
| Request log/context | Infrastructure HTTP transversal |
| Use-case outcome relevante | Application/módulo propietario |
| Audit | Audit capability dentro de transaction |
| Error capture/redaction | Cross-cutting infrastructure |
| API/DB/pool metrics | Infrastructure/adapters |
| Operación de dominio seleccionada | Punto único del use case |

Evitar que controller, service y repository registren el mismo evento.

## 88. Controller logging

Controllers no registran manualmente start/end: interceptor/middleware central lo hace con route template, status y duration. Solo emiten un evento si existe preocupación genuina de presentation no cubierta; no loguean DTOs.

## 89. Repository logging

Repositories no imprimen cada query exitosa. Exponen timing/error a instrumentation transversal y agregan query name solo para operaciones especiales. Traducen errores sin tragarlos ni serializar Prisma/SQL/raw params.

## 90. Use case logging

Use cases pueden emitir un único resultado semántico relevante, por ejemplo `sale.confirmed` o `sale.cancellation_blocked_non_reversible`, con IDs seguros y outcome. No duplican request log ni reconstruyen Audit; fallos se propagan al handler común.

## 91. Error handling integration

El exception filter traduce errores tipados y el capture layer recibe solo unexpected/infrastructure. Ambos usan el mismo request context. La respuesta externa contiene código/mensaje seguro/requestId; el evento interno conserva stack/cause sanitizados. Fallar el envío a Sentry no cambia la respuesta ni oculta el error original.

## 92. Validation errors

No enviar cada error de Zod/DTO/form a Sentry como exception. Contar por route/código agregado si ayuda a detectar abuso o contrato roto; logs detallados solo con campos allowlisted y nunca valores ingresados.

## 93. 404

Un 404 aislado es normal y tenant-safe, no ERROR. Medir volumen agregado por route/origin class; probes repetidos o patrón cross-tenant alimentan seguridad sin revelar si el recurso existe.

## 94. 409 conflicts

Conflictos de concurrency/idempotency/domain state pueden ser resultado esperado. Registrar código/operation a INFO o WARN contextual y contar; alertar solo por spike, retry exhaustion, partial-effect suspicion o cambio respecto al baseline.

## 95. Observability testing

Tests futuros verifican generación/validación/propagación de requestId, contexto async, safe error response, redaction, liveness/readiness, release metadata y audit correlation. Probar contracts propios y configuración, no internals de Sentry/Pino/hosting.

## 96. Redaction testing

Critical: pasar estructuras conocidas con password/hash, tokens, cookies, Authorization, CSRF, DB URL, signed URL y nested variants por logger/error sanitizer y afirmar ausencia de valores. Incluir keys con distinta capitalización, errores serializados y free text. Un cambio de logger/SDK exige regresión.

## 97. Error tracking test

Staging debe emitir un error sintético controlado durante verificación autorizada y confirmar project, environment, release, stack/source map, requestId y redaction. No dejar endpoint público ni trigger permanente capaz de generar exceptions.

## 98. Health tests

Integration: liveness healthy sin dependencias; readiness healthy con DB; readiness falla rápido y seguro sin DB o durante draining; ambos sin secretos/versiones internas. Verificar timeout y que ningún check modifica datos.

## 99. Load test observability

Durante 10/20/40 usuarios observar p50/p95/p99, 5xx/conflicts, in-flight, DB pool/wait, query latency/slow queries, deadlocks/locks y CPU/memory si hosting lo expone. Registrar release/dataset/escenario para comparar; no evaluar solo respuestas finales.

## 100. Deployment comparison

Release markers permiten comparar ventanas before/after para error rate, latency, slow operations, login y pool. Usar misma route/traffic class y reconocer cambios de carga. Un dashboard/anotación de deployment debe enlazar al release sin exponer commit metadata sensible públicamente.

## 101. Rollback signals

Señales candidatas: 5xx severo sostenido posterior al deploy, failed migration/compatibility, sospecha tenant isolation, transaction failures críticas, login outage o readiness persistente. En V1 una persona evalúa impacto y compatibilidad DB antes de rollback; no automatizarlo sin madurez.

## 102. Incident evidence

Preservar logs relevantes, Audit Records, Sentry events, release IDs, UTC timestamps, alerts y cambios de configuración autorizados. Restringir acceso, documentar cadena/exports y evitar rotación/borrado accidental del subconjunto. No copiar secretos a tickets/chat.

## 103. Incident minimal procedure

1. Detectar y abrir registro.
2. Evaluar severidad/alcance.
3. Contener sin destruir evidencia.
4. Identificar release, request IDs, environment y Organizations potenciales.
5. Diagnosticar con logs/error/metrics/audit.
6. Remediar o rollback seguro.
7. Verificar salud e invariantes.
8. Documentar impacto, timeline y seguimiento.

## 104. Post-incident review

Todo Critical/High documenta causa, impacto, detección, timeline, resolución, factores contribuyentes, prevención y tests/telemetría/runbook faltantes. Asignar owners/fechas y revisar efectividad. El objetivo es mejorar sistema/proceso, sin culpa.

## 105. Cost control

Evitar DEBUG permanente, bodies, labels de alta cardinalidad, traces masivos, retención indefinida y herramientas duplicadas. Definir quotas/sampling y revisar volumen/costo mensual. Primero reducir telemetría sin uso; nunca samplear ciegamente seguridad/errores críticos para resolver presupuesto.

## 106. Vendor strategy

Usar pocas capacidades administradas y no construir plataforma propia. Structured JSON y campos propios mantienen portabilidad; Sentry resuelve errores/performance limitada; hosting/PostgreSQL gestionan métricas/log ingestion. OTel/OTLP futuro ofrece ruta vendor-neutral cuando el costo de migración o complejidad lo justifique.

## 107. V1 tool recommendations

| Necesidad | Recomendación |
|---|---|
| Backend structured logger | **Pino** detrás de adapter compatible con Nest LoggerService, JSON/redaction central y pretty transport solo local. |
| Error tracking | **Sentry administrado** para React y Node/Nest, proyectos/environments separados. |
| Performance traces | Sentry Performance limitado/muestreado para HTTP/DB/storage; sin collector propio. |
| Logs/metrics/runtime | Capacidades del proveedor de hosting elegidas en BCM-010. |
| PostgreSQL | Metrics, slow query/locks y insights del proveedor administrado elegido. |
| Uptime | Monitor externo simple administrado o capability independiente del hosting. |

No se instala ni configura ninguna herramienta en BCM-009.

## 108. Sentry decision

Decisión V1: adoptar Sentry o equivalente para Web/API al implementar observabilidad. Configurar `sendDefaultPii` deshabilitado, scrubbing provider-side y hooks allowlist; deshabilitar captura de bodies/local variables sensibles y revisar breadcrumbs. Asociar environment/release/requestId. Source maps se suben privadamente y no se sirven. Sampling de performance comienza bajo; error capture inesperado no se samplea arbitrariamente.

## 109. OpenTelemetry decision

**Deferred but architecture-ready.** El monolito modular, PostgreSQL y pocas dependencias no justifican SDK + Collector + backend adicional en V1. Mantener context propagation, route/query/operation names y adapter de metrics para migrar. Trigger: múltiples servicios/jobs, necesidad de vendor portability, investigación cross-service difícil o gaps/costo de Sentry/hosting.

## 110. Metrics strategy

Se elige **A: hosting + PostgreSQL provider + Sentry Performance limitado**, complementado por pocas métricas application de baja cardinalidad. No self-host Prometheus/Grafana V1. BCM-010 evaluará que el proveedor exponga RED, runtime/pool/DB y alerting/export; si no alcanza, se registra decisión arquitectónica para managed metrics u OTel, no un stack casero.

## 111. Uptime tool

Usar monitor externo simple/proveedor distinto del proceso observado, con checks HTTPS de Web y API health, historial y notificación. La marca concreta es `DEP-DEC candidate`; no desarrollar cron propio ni hacer mutations comerciales.

## 112. Development observability

- **Local:** eventos pretty, DEBUG opt-in, errores inmediatos y Prisma query debug temporal.
- **Test:** logs silenciosos por defecto; mostrar buffer/contexto al fallar tests relevantes.
- **Staging:** JSON centralizado, Sentry/métricas equivalentes a production y sampling mayor controlado.
- **Production:** JSON centralizado, INFO+, redaction, Sentry y sampling/costos controlados.

La semántica funcional no cambia por environment.

## 113. Documentation for operations

### How to investigate an error

1. Obtener requestId y timestamp.
2. Buscar el error event y confirmar environment.
3. Identificar Web/API release y deployment marker.
4. Inspeccionar logs correlacionados y operation/query timings.
5. Validar Organization afectada mediante ID interno y acceso autorizado.
6. Consultar Audit si fue acción de negocio sensible.
7. Reproducir con datos sintéticos en entorno seguro y agregar regresión.

Nunca diagnosticar ejecutando cambios destructivos en production.

## 114. Observability Definition of Done

Una feature Critical revisa error context y safe response, request correlation, Audit obligatorio, operation/query names, redaction y una señal metric/event solo si es operativamente útil. Incluye tests de controles nuevos y runbook/alert owner si aplica. No exige métrica por cada CRUD.

## 115. AI/Codex observability rules

Cuando Codex implemente:

- no dejar `console.log`/debug permanente;
- no loguear request/body/Error completos ni secretos;
- reutilizar logger, event names y request context;
- incluir requestId en errores seguros;
- no capturar expected errors como fatal;
- no crear labels de cardinalidad alta;
- no instalar SDK/dependencia sin tarea autorizada;
- no silenciar errores para reducir ruido;
- explicar objetivo, campos, redaction, volumen y tests de toda instrumentación nueva.

## 116. Anti-patterns

- Logging everything o no logging.
- Secrets/PII en plaintext.
- Audit usado como log técnico o logs usados como database.
- IDs individuales/raw URLs en metric labels.
- Cada 4xx enviado a Sentry.
- Health revelando configuración.
- Source maps públicas sin análisis.
- DEBUG permanente en producción.
- Prometheus/Grafana antes de necesidad.
- Un span por función.
- Alertar cada occurrence.
- Sin release markers o request correlation.
- Herramientas duplicadas para la misma señal.

## 117. Security alignment

La estrategia cumple redaction allowlisted, tenant privacy, prohibición de tokens/credentials, separación de Platform Admin, Audit append-oriented e incident evidence de SECURITY.md. `Security Review Required`: **No**. Cualquier futura captura de PII, session context ampliado o proveedor/región fuera de política exige revisión.

## 118. Testing alignment

TESTING.md permite integration de requestId/health/audit, pruebas Critical de redaction, synthetic Sentry en staging y visibilidad durante carga 10/20/40. `Testing Review Required`: **No**. La implementación futura debe agregar los tests descritos sin probar internals de vendors.

## 119. Architecture alignment

Structured logging, error tracking, health, metrics y trazas básicas satisfacen ARCHITECTURE sin infraestructura distribuida prematura. `Architecture Review Required`: **No**. Adoptar OTel Collector, Prometheus/Grafana, SIEM o pipeline propio sí requerirá nueva decisión/revisión.

## 120. Deployment alignment

BCM-010 debe decidir capacidades concretas de log ingestion, metrics/runtime, PostgreSQL insights, uptime/alert routing, secret injection, release/source-map upload, retention/cost, health routing y rollback markers. Se registran como candidatos:

- `DEP-DEC candidate: hosting observability capabilities`;
- `DEP-DEC candidate: managed PostgreSQL telemetry`;
- `DEP-DEC candidate: Sentry projects, region, retention and secrets`;
- `DEP-DEC candidate: external uptime provider and notification channel`.

No se inventa proveedor cloud ni configuración en BCM-009.

## Required decision verification

- Logging: Pino/adapter, JSON production y campos/eventos estables.
- Correlation: request ID validado, propagado a respuesta/log/error/audit.
- Error tracking: Sentry/equivalente Web/API con grouping, release y redaction.
- Health/uptime: liveness/readiness separados y monitor externo.
- Metrics: RED API, DB/pool/transaction y operaciones seleccionadas.
- Slow queries: threshold inicial configurable de 250 ms y query names seguros.
- Release: Web/API build ID, commit SHA y deployment markers internos.
- Alerts: baseline pequeño, accionable y por severidad.
- Tracing: Sentry Performance básico; OpenTelemetry diferido/preparado.
- Infrastructure: hosting/managed PostgreSQL capabilities; no Prometheus propio.
- Privacy: allowlist/redaction, retención finita y cero bodies/secrets.
- Incidents: procedimiento mínimo, evidence preservation y post-review.

## Final review

Se revisaron SECURITY, TESTING, BACKEND_STANDARDS, FRONTEND_STANDARDS y ADRs; request IDs, redaction, tenant privacy, DB/pool/slow queries, load-test visibility, labels, sampling, alerts e infraestructura. Producción queda diagnosticable por release → error/requestId → logs/metrics/query → Audit sin debugger ni datos sensibles. No se encontraron contradicciones.

## Technical references

- Pino, API y redaction documentation.
- Sentry, JavaScript/Node error tracking, releases y source-map documentation.
- OpenTelemetry, JavaScript status, instrumentation and metrics documentation.
- Google web.dev, Core Web Vitals.
- PostgreSQL, monitoring, locks and statistics documentation.
