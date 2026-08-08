# BCM SOFT — Testing & Quality Strategy

Propósito: definir una estrategia obligatoria de testing y quality assurance proporcional al riesgo de BCM SOFT.

Estado: `Completed`.

Alcance: reglas y decisiones documentales para futuras pruebas. Esta fase no crea tests, configuración de CI ni dependencias.

## 1. Testing philosophy

1. Probar comportamiento, no detalles de implementación.
2. Elegir profundidad según riesgo.
3. Proteger con mayor fuerza las invariantes comerciales críticas.
4. Probar comportamiento PostgreSQL contra PostgreSQL.
5. Incluir casos negativos para controles de seguridad.
6. Probar concurrencia de forma simultánea y explícita.
7. Usar E2E selectivamente, no como estrategia completa.
8. Mantener pruebas deterministas, legibles y aisladas.
9. Tratar una suite no confiable como un defecto del producto.
10. Usar coverage como diagnóstico, no como objetivo.
11. Considerar todo flaky test un bug.
12. Priorizar prevención de pérdida de datos, fuga tenant, stock inconsistente y cálculos económicos incorrectos.

## 2. Testing pyramid / layers

| Capa | Responsabilidad |
|---|---|
| Unit | Reglas puras, value objects, cálculos y transiciones sin I/O. |
| Application | Coordinación de casos de uso con ports controlados cuando aporta una señal clara. |
| Database Integration | Constraints, migrations, precisión, RLS, transactions, locks e idempotencia sobre PostgreSQL real. |
| API Integration | HTTP, validación, auth, autorización, errores, aplicación y base real según el caso. |
| Frontend Unit / Component | Helpers y comportamiento observable de componentes aislados. |
| Frontend Integration | Feature renderizada con providers reales y frontera HTTP controlada. |
| End-to-End | Pocos flujos críticos atravesando browser, Web, API y PostgreSQL. |

La base de la estrategia son unit e integration; E2E verifica ensamblaje y journeys, no repite toda la matriz inferior.

## 3. What NOT to test

No crear tests para getters sin lógica, decorators del framework, render estático trivial, llamadas privadas sin significado conductual o internals de React/NestJS. No afirmar que un mock fue llamado si el resultado observable o la invariante es lo importante. Cada test debe proteger una falla plausible.

## 4. Risk classification

| Riesgo | Consecuencia | Profundidad mínima |
|---|---|---|
| Critical | Pérdida/corrupción de datos, dinero incorrecto, fuga tenant o bypass de seguridad | Unit cuando hay lógica pura, DB/API integration, casos negativos y concurrency cuando aplique; E2E para journeys representativos. |
| High | Operación principal incorrecta o regresión difícil de detectar | Unit/application más integration; casos de error y contrato; E2E selectivo. |
| Medium | Degradación funcional recuperable | Tests focalizados de componente, API o unit según boundary. |
| Low | Cambio visual/textual o plumbing sin lógica | Typecheck, lint, review y test simple solo si protege comportamiento. |

La categoría se asigna en el mini test plan y aumenta si toca múltiples Organizations, historial, stock, dinero, permisos o carreras.

## 5. Critical domain areas

Son Critical inicialmente: tenant isolation; autenticación y sesiones; autorización; confirmación y cancelación/reversión de Sale; disponibilidad de Equipment; stock de Accessories; unicidad y conversión de Reservation; Trade-In; inventory movements; snapshots monetarios; Moving Weighted Average Cost; e idempotencia.

## 6. Global Domain Invariants

`X` indica una capa obligatoria cuando aplica; `—` indica que otra capa ofrece mejor señal. E2E cubre una muestra, no cada combinación.

| Invariant | Risk | Unit | DB Integration | API | Concurrency | E2E |
|---|---|---:|---:|---:|---:|---:|
| Stock de Accessories nunca negativo | Critical | X | X | X | X | X |
| Equipment no vendido dos veces | Critical | X | X | X | X | X |
| Equipment no reservado dos veces | Critical | X | X | X | X | X |
| Sale Confirmed no se edita/elimina destructivamente | Critical | X | X | X | — | X |
| Cancelación/reversión idempotente | Critical | X | X | X | X | X |
| Valores históricos permanecen inmutables | Critical | X | X | X | — | X |
| Trade-In conserva origen y relación con Sale | Critical | X | X | X | — | X |
| Datos tenant permanecen aislados | Critical | — | X | X | X | X |
| IMEI único dentro de Organization | High | X | X | X | X | — |
| Snapshot de cotización permanece inmutable | Critical | X | X | X | — | X |
| Moving Weighted Average Cost se preserva | Critical | X | X | X | X | X |
| Sale Confirmed aplica todos sus efectos o ninguno | Critical | X | X | X | X | X |
| Reservation Active bloquea venta normal | Critical | X | X | X | X | X |
| Trade-In posterior bloquea reversión automática | Critical | X | X | X | X si compite | X |
| Inventory movement explica cada cambio | High | X | X | X | X | — |

La trazabilidad detallada puede ampliar esta matriz vinculando invariant, escenario y test concreto.

## 7. Unit tests — Domain

Usar para state transitions, money/rate/rounding, weighted average, permission mapping, validaciones puras, reversibilidad y políticas de dominio. Deben ejecutarse rápido y no iniciar NestJS ni PostgreSQL cuando la regla no dependa de ellos.

## 8. Unit test style

Adoptar Arrange / Act / Assert o un equivalente evidente. Cada test expresa una regla en su nombre, por ejemplo `cannot confirm sale when equipment is already sold`; evitar `test case 17`. Un fallo debe indicar qué comportamiento se rompió.

## 9. Application/use-case tests

Son útiles para `ConfirmSale`, `CancelSale` o `ReserveEquipment` cuando se desea verificar coordinación, decisiones y efectos solicitados a ports pequeños. Si requiere mockear gran parte de la infraestructura o la garantía depende de transaction/constraint, preferir database/API integration con componentes reales.

## 10. Database integration tests

Son obligatorios para FKs, UNIQUE —incluidos parciales—, CHECK, tenant-aware relationships, numeric precision, transactions, RLS, locks, idempotencia y mappings Prisma. Deben usar una versión PostgreSQL compatible con producción y el rol runtime real. SQLite, repositorios in-memory y mocks no sustituyen estas pruebas.

## 11. Database test environment

Estrategia V1: una instancia PostgreSQL efímera por job y **una database aislada por worker**. Cada worker aplica migrations y ejecuta suites sobre su propia database; entre tests se usa truncation controlada en orden seguro o escenarios autocontenidos.

No se adopta rollback envolvente como regla general porque API y concurrency usan múltiples conexiones/transacciones que no participarían del mismo wrapper. Puede usarse localmente en una suite single-connection demostrablemente segura. La paralelización se habilita solo después de validar que database, nombres y cleanup están aislados.

## 12. Migrations testing

El pipeline futuro comprobará database vacía → latest, orden e inmutabilidad de migrations, consistencia con Prisma schema y fallos legibles. Para cambios sensibles también ejecutará upgrade desde snapshot representativo. No se editan migrations aplicadas ni se usa `prisma db push` como sustituto de migration testing production-like.

## 13. RLS tests

Con policies/FORCE RLS y rol runtime reales: A crea el recurso; B no puede leer, insertar relacionado, modificar ni eliminar; `WITH CHECK` impide cambiar Organization; sin Current Organization context el acceso falla cerrado. Verificar además que el contexto transaction-local no se filtra al devolver una conexión al pool y que runtime no es owner, superuser ni `BYPASSRLS`.

## 14. Cross-tenant API tests

Además de RLS, manipular IDs de Equipment, Sale, Customer, Reservation, File y Audit de B desde una sesión de A. Cubrir GET, update, acciones de dominio y delete cuando exista. Esperar 404/no accesible o el contrato seguro definido, sin diferencias que permitan enumeración; comprobar ausencia de efectos en B.

## 15. Authentication tests

Cubrir credenciales válidas e inválidas, respuesta genérica para cuenta desconocida, User disabled, sesión expirada/revocada/malformed, logout, replay posterior, hash de token no plaintext, expiración absoluta e idle. Verificar rotación cuando corresponda y que nunca se imprimen secretos.

## 16. Password tests

No probar internals criptográficos de Argon2. Verificar integración: password válida autentica, inválida falla, persistencia contiene hash no secreto, parámetros antiguos disparan rehash seguro y reset invalida sesiones/tokens conforme a SECURITY.

## 17. CSRF tests

Para endpoint mutante autenticado: token válido aceptado; faltante o incorrecto rechazado; Origin fuera de allowlist rechazado cuando aplica; el rechazo no deja efectos. GET/HEAD/OPTIONS seguros no requieren el comportamiento de mutation ni cambian estado.

## 18. Authorization tests

Mantener matriz por permission/capability, no solo roles. Para cada operación sensible: permiso válido funciona; sin sesión → 401; sesión sin permiso → 403; recurso cross-tenant no accesible; Membership revocada/version stale deniega; switch inválido rechaza. Probar guard y policy del caso de uso.

## 19. Sessions + organization switching

Probar switch a Membership válida, Organization inválida, Membership revocada, actualización atómica del contexto/version y ausencia de acceso al tenant previo. E2E selectivo verifica que la Web limpia cache y no muestra datos anteriores; API/DB verifican la seguridad real.

## 20. Sale confirmation tests

Critical. Una venta válida pasa a Confirmed, Equipment a Sold, crea movements/audit, conserva price/cost/currency/exchange-rate snapshots y pertenece a la Organization correcta. Repetir con la misma key retorna el mismo resultado lógico. Estado inválido o efecto fallido revierte toda la transacción.

## 21. Concurrent Equipment sale

Coordinar dos transacciones realmente simultáneas sobre el mismo Equipment mediante una barrera, no llamadas secuenciales. Exactamente una confirma; la otra recibe conflict controlado. Postcondición: una Sale válida, Equipment Sold y un único conjunto de líneas/movements/audit/idempotency effects.

## 22. Accessory sale tests

Cubrir decremento por cantidad, stock no negativo, snapshot del WAC vigente, regalo con precio cero, varias líneas, cancelación que restaura exactamente y conservación del costo histórico tras ingresos posteriores.

## 23. Concurrent accessory stock

Con stock 1, iniciar dos ventas simultáneas de cantidad 1. Una confirma y otra falla controladamente; stock final 0, nunca -1, sin línea ni movement huérfano. Ejecutar además variantes con productos distintos para detectar locks demasiado amplios.

## 24. Weighted Average Cost tests

Caso mínimo: 10 unidades a 5 más 10 a 7 produce promedio 6 según precisión DB. Una Sale copia costo histórico 6; un ingreso posterior recalcula el producto pero no modifica la Sale. Agregar decimales que detecten floating point, escala y redondeo incorrectos, y concurrencia de ingresos.

## 25. Sale cancellation tests

Una Sale Confirmed reversible pasa a Cancelled, restaura Equipment/Accessories, crea movements compensatorios, conserva original, registra actor/fecha/motivo/audit y no reescribe snapshots. Repetir no restaura ni audita dos veces.

## 26. Non-reversible cancellation

Si un Trade-In u otra operación posterior vuelve la venta no reversible, esperar `Manual Resolution Required` o conflicto definido. Sale, stock, estados y movements previos permanecen sin cambios parciales.

## 27. Trade-In tests

Verificar Equipment recibido, acquisition cost igual al valor de toma, relación con Sale, Customer obligatorio, saldo monetario correcto, valor económico preservado sin doble conteo de profit y movement de ingreso. Cualquier fallo revierte venta e ingreso juntos.

## 28. Trade-In cancellation

Caso reversible: Equipment recibido intacto permite compensación completa. Caso no reversible: si fue vendido, reservado de forma dependiente o transformado, cancelar automáticamente se rechaza y no altera operaciones posteriores.

## 29. Reservations

Probar reserva de Equipment Available, transición a Reserved, Customer obligatorio, rechazo de segunda Active, bloqueo de venta normal, cancelación que libera y conserva trazabilidad, y conversión al mismo Customer exactamente una vez.

## 30. Concurrent reservations

Dos sesiones intentan reservar simultáneamente la misma unidad. Una sola Reservation Active sobrevive; la otra obtiene conflict. Verificar conjuntamente lock/status, UNIQUE parcial, un movement y ausencia de estado parcial.

## 31. Sale vs reservation race

Sincronizar confirmación de Sale y creación de Reservation sobre el mismo Equipment. Solo una operación puede ganar. Nunca deben coexistir Sale Confirmed y Reservation Active incompatibles; la perdedora no deja líneas, movements ni estados parciales.

## 32. IMEI tests

Cubrir IMEI válido normalizado, duplicado dentro de la misma Organization rechazado, mismo IMEI en otra Organization permitido por el diseño tenant, NULL cuando corresponda y formatos inválidos. Incluir inserciones concurrentes para demostrar la UNIQUE parcial, no solo validación application.

## 33. Money tests

Cubrir USD; ARS con exchange rate positivo; rate ausente, cero o negativo; importes negativos donde estén prohibidos; snapshots y numeric precision. Usar valores como decimales fraccionarios que fallarían con binary floating point. Cambios de cotización actual nunca recalculan historia.

## 34. Sale without Customer

Probar que Standard Sale permite Customer ausente, Reservation exige Customer y Trade-In exige Customer. Esto evita convertir accidentalmente una precondición contextual en una validación global de toda Sale.

## 35. Inventory adjustment tests

Exigir permission, motivo, actor y fecha; actualizar stock y crear movement/audit en una transacción. Rechazar resultado negativo y verificar rollback total ante cualquier fallo.

## 36. Audit tests

Para acciones sensibles afirmar actor, Organization, action, entity, reason cuando aplica y correlation. No acoplar cada test a todo el schema interno de audit. Verificar append-only, atomicidad requerida y que datos sensibles no aparecen en payloads/logs.

## 37. Idempotency tests

Cubrir misma key + mismo request, duplicado secuencial, reutilización del resultado, misma key con payload/operación incompatible, scope independiente por Organization, autorización reevaluada y requests duplicadas concurrentes. Una key `InProgress` no permite doble ejecución y los efectos aparecen una sola vez.

## 38. Recovery token tests

Token válido, expired, used, revoked y random invalid; segundo uso rechazado; solo hash persistido; reset invalida sesiones/tokens según policy; respuestas públicas permanecen genéricas. Incluir carrera de doble consumo para probar update condicional atómico.

## 39. Invitation tests

Cubrir válida, expired, revoked, email/Organization incorrectos, segunda aceptación, duplicate Membership y role aplicado. Solo hash persistido y acceptance/membership ocurren atómicamente sin revelar existencia de cuentas.

## 40. Rate limiting tests

Probar requests permitidas, threshold, 429, `Retry-After` cuando corresponda, expiry/reset de ventana e identity fingerprint por operación. Usar clock controlable, no sleeps. Las respuestas no deben permitir account enumeration y restart no debe borrar protección persistente cuando esa capa aplique.

## 41. File tests

Critical/High. Usar fixtures inertes para JPEG, PNG y WebP válidos; oversize; dimensiones/decompression bomb simulada; MIME/extensión/magic mismatch; nombre/path malicioso y contenido activo seguro de prueba. Verificar metadata cross-tenant, permission antes de signed URL, key manipulada, expiración y delete repetido. Nunca ejecutar malware real.

## 42. API contract tests

Verificar status, error seguro `{ code, message, details?, requestId }`, decimals serializados como strings, camelCase, paginación, campos requeridos y minimización de datos. Preferir assertions focalizadas o schemas; no snapshots enormes que oculten cambios.

## 43. Pagination tests

Cubrir default 25, máximo 100, límites inválidos, page/cursor según contrato, filtros, sort allowlist, total metadata o `nextCursor/hasMore`, y resultados tenant-scoped. No aceptar consultas sin bound.

## 44. Search tests

Cubrir búsquedas por IMEI, sale number, Customer y SKU según cada contrato. Verificar normalización, límites, parámetros inválidos y tenant isolation. No exigir fuzzy/full-text avanzado mientras no esté diseñado.

## 45. Frontend testing principles

Probar conducta que una persona observa: interacción, loading/refetch, empty/error, permisos UX, forms, mutations y transiciones tenant. No inspeccionar internals de React, state variables o llamadas entre hooks cuando el resultado puede observarse.

## 46. Frontend unit tests

Adecuados para formatters de dinero/fechas, permission helpers, parsing, query-param normalization, feature utilities y reducers complejos si aparecen. No renderizar React para lógica pura.

## 47. Frontend component tests

Usar **Vitest + React Testing Library + user-event** con una implementación DOM compatible. Consultar por role, label y nombre accesible; `data-testid` es último recurso. Renderizar los providers mínimos reales y afirmar comportamiento, no árbol del componente.

## 48. Frontend network mocking

Se adopta **MSW** para interceptar requests en la frontera de red en component/integration tests. Los handlers modelan contratos REST, auth, latencia controlada y errores sin mockear TanStack Query, hooks o el cliente HTTP. Un request no manejado debe fallar el test para detectar dependencia accidental; MSW no será fallback de producción.

## 49. Frontend session tests

Cubrir bootstrap checking, authenticated y unauthenticated; 401 limpia cache/redirige sin loop; 403 mantiene sesión; logout borra datos; Organization switch bloquea vista, limpia cache tenant y no muestra contenido anterior.

## 50. Frontend permission tests

Una persona sin `sales.cancel` no puede iniciar la acción normal y recibe UX coherente. Con permiso sí puede. Estas pruebas validan experiencia; la matriz API sigue siendo la barrera de seguridad.

## 51. Frontend forms

Equipment creation, Sale, Reservation y Customer dentro de Sale deben cubrir validación, field/form server errors, dirty, pending, doble submit y éxito. Probar Standard Sale sin Customer y Customer obligatorio en Reservation/Trade-In.

## 52. Frontend critical mutation behavior

En Confirm Sale: mostrar pending, impedir doble click, mantener la idempotency key de la intención, presentar conflict de dominio, no aplicar optimistic update ciego y reconciliar con la respuesta autoritativa.

## 53. Frontend accessibility tests

Automatizar roles, labels, nombres, errores anunciados, foco de dialogs y keyboard en primitives/flujos críticos. Una herramienta automática de reglas puede complementar, pero nunca justificar por sí sola accesibilidad; incluir revisión manual de teclado, zoom/reflow y lector de pantalla en releases relevantes.

## 54. Responsive testing

Revisar categorías mobile, tablet y desktop con viewports representativos. Priorizar usabilidad, overflow, acciones visibles/alcanzables, forms, dialogs y transformación de tablas. Evitar snapshots pixel-perfect de cada breakpoint.

## 55. E2E philosophy

E2E es más lento y costoso; se reserva para verificar integración completa y journeys de riesgo. No duplica combinaciones ya cubiertas en unit/API/DB. Cada flujo debe ser independiente, usar datos propios y dejar evidencia diagnóstica al fallar.

## 56. E2E critical flows

Backlog mínimo progresivo:

1. Login → Inventory → create Equipment.
2. Login → create/select Customer → confirm Sale.
3. Sale with Accessory.
4. Trade-In Sale.
5. Reservation → Convert to Sale.
6. Cancel reversible Sale.
7. Authorization denied.
8. Cross-tenant isolation.

No deben implementarse todos en el primer commit: cada feature agrega su flujo cuando alcanza madurez, priorizando Sale, tenant y auth.

## 57. E2E tooling

Se adopta **Playwright Test** frente a Cypress para V1. La elección concentra runner, assertions, aislamiento de browser contexts, trazas, debugging, paralelización y soporte Chromium/Firefox/WebKit con TypeScript. Comenzar con Chromium en PR para feedback rápido; ejecutar la matriz ampliada en main/release según riesgo.

## 58. Browser matrix

Soporte conceptual: versiones modernas actuales de Chrome/Chromium y Edge como prioridad administrativa; Firefox actual como verificación regular; Safari mediante WebKit y, antes de comprometer soporte comercial, validación manual en Safari real cuando corresponda. No soportar browsers obsoletos sin requisito comercial.

## 59. Test fixtures

Evitar fixtures globales gigantes. Usar factories, builders y escenarios mínimos con nombres como `givenAvailableIphone()`. Los defaults deben ser válidos y visibles; overrides explican lo relevante del caso.

## 60. Factory ownership

Factories de Sales, Reservations o Inventory permanecen cerca de sus suites/módulos. Solo Organization, User y authenticated context verdaderamente transversales van a test support compartido. No crear un dumping ground `test-utils`.

## 61. Determinism

No depender de fecha real, random no controlado, orden de ejecución, servicios externos, red pública o mutable state compartido. Fijar inputs y registrar seed cuando una técnica aleatoria futura lo requiera. El mismo commit y entorno deben producir el mismo resultado.

## 62. Clock testing

Sessions, recovery/invitation tokens, rate windows y futura Reservation expiry usan un clock inyectable/fake. Avanzar tiempo explícitamente; no esperar tiempo real con `sleep`. En integration, fijar timestamps o probar el reloj DB mediante rangos solo cuando ese comportamiento sea el objetivo.

## 63. Identifier determinism

Inyectar generador UUID cuando un ID conocido sea relevante para idempotencia, correlación o assertions. En los demás casos afirmar relaciones y formato, no valores arbitrarios exactos.

## 64. Test isolation

Cada test crea sus precondiciones mínimas y no requiere uno anterior. No asumir sequences, IDs o residuos compartidos. El cleanup debe ser seguro aun si el test falla y nunca apuntar fuera de la database de test validada.

## 65. Parallel tests

Unit/component pueden paralelizar por defecto después de confirmar aislamiento. DB/API usan database por worker y no comparten nombres ni mutable fixtures. Concurrency interna de un escenario se controla deliberadamente; no confundirla con paralelizar archivos. Habilitar workers gradualmente según capacidad de PostgreSQL y pool.

## 66. Flaky test policy

Un flaky test es un bug. Investigar timing, isolation, dependencia externa o selector; corregirlo. Si bloquea el pipeline, solo puede aislarse temporalmente con issue, owner, evidencia y fecha/trigger de restitución. Nunca “rerun until green” ni ignorarlo indefinidamente.

## 67. Retry tests

Retries no arreglan flakes. Unit, integration y API no deben depender de ellos. E2E puede usar un retry limitado por fallas de infraestructura, reportado como flaky y visible en tendencias; un pase por retry no cierra automáticamente la investigación.

## 68. Coverage

Medir line/branch/function coverage como señal de huecos, no meta de 100% ni único gate global. No crear tests triviales para subir porcentaje. Los módulos Critical requieren evidencia conductual de invariantes y ramas de error, aunque el porcentaje general sea menor; cualquier threshold futuro debe ser razonable, incremental y revisado.

## 69. Mutation testing

No es requisito V1. Podrá evaluarse sobre cálculos financieros o state machines críticas cuando la suite base sea estable y exista evidencia de que assertions débiles pasan mutaciones relevantes.

## 70. Property-based testing

Es opción futura para Money, weighted averages e invariantes con rangos amplios. No es obligatorio en V1; ejemplos numéricos y bordes bien elegidos son suficientes inicialmente. Toda generación debe conservar seed para reproducibilidad.

## 71. Static quality gates

Formatting check, lint, TypeScript typecheck estricto y build son gates separados y rápidos. Se ejecutan antes o en paralelo con tests para fail-fast, pero no reemplazan comportamiento, runtime validation ni integration.

## 72. Dependency/security tests

CI futuro valida lockfile reproducible, escanea vulnerabilidades y secretos. Hallazgos se clasifican por explotabilidad, alcance, disponibilidad de fix y riesgo; Critical/High relevante bloquea o exige excepción explícita con owner/expiry. No bloquear automáticamente producción por cualquier warning sin análisis, ni ignorar alertas silenciosamente.

## 73. Schema validation

Contratos se protegen con TypeScript en compile time, schemas runtime en fronteras y API integration sobre payload real. Ninguna de las tres capas sustituye a las otras. Probar rechazo de shape inválido y ausencia de internals sensibles.

## 74. Test environment security

Credenciales y secrets son exclusivos del entorno test, de mínimo privilegio y nunca de production. Object storage/email externos usan servicios fake o aislados cuando corresponda. Logs de tests no imprimen tokens, cookies ni passwords. Datos reales requieren anonimización y proceso aprobado; por defecto se usan sintéticos.

## 75. Production data

Está prohibido ejecutar pruebas destructivas o suites de mutation contra production, usar production como staging o copiar datos de clientes sin proceso aprobado. Los comandos de test deben validar environment/database target y fallar cerrados ante ambigüedad.

## 76. CI stages

Pipeline conceptual:

1. install reproducible;
2. format check;
3. lint y architecture rules;
4. typecheck;
5. unit tests;
6. frontend component/integration;
7. database integration y migrations;
8. API/security/concurrency integration;
9. Web/API build;
10. dependency/secret checks;
11. E2E selectivo.

Los stages rápidos pueden correr en paralelo; los pesados empiezan tras gates básicos o según análisis de costo. Esta tarea no configura CI.

## 77. Pull Request gates

Antes de merge: checks obligatorios verdes, ningún Critical regression conocido, migrations revisadas si aplica y tests relevantes agregados/actualizados. Excepciones exigen riesgo, owner y plan. Manual QA completa no se requiere para cada cambio pequeño; se aplica proporcionalmente.

## 78. Branch testing

Cada PR ejecuta suite proporcional a los paths y riesgos, sin omitir gates mínimos. Main ejecuta integración suficiente y permanece deployable. La selección por cambios debe ser conservadora: shared contracts, auth, DB o infraestructura amplían el alcance.

## 79. Pre-production tests

Staging production-like valida migrations, configuración, smoke, journeys E2E clave, roles/permissions y checks de seguridad. Debe usar credenciales/datos separados y la misma clase de PostgreSQL/object storage, sin depender de production.

## 80. Smoke tests

Suite post-deploy breve: frontend reachable, API health, DB readiness, ruta de autenticación y query básica autenticada. Preferir operaciones read-only o datos sintéticos dedicados; no confirmar/cancelar ventas comerciales reales. Resultado debe ser rápido y diagnóstico.

## 81. Production verification

Después del deploy revisar health, migration status, error rate, latency y flujos básicos seguros mediante observabilidad y smoke no destructivo. No ejecutar la suite completa ni pruebas de carga/concurrencia contra datos productivos.

## 82. Regression tests

Todo bug importante debe, cuando sea práctico, producir un test que falla antes y pasa después. Es obligatorio priorizar regresión automatizada en fuga cross-tenant, dinero, inventory, concurrency, permissions y pérdida de datos. Si no es automatizable, documentar el caso manual y el motivo.

## 83. Bug reproduction workflow

1. Reproducir en entorno seguro.
2. Identificar invariant y capa responsable.
3. Agregar o identificar el test que falla.
4. Corregir causa raíz.
5. Ejecutar suite focalizada y capas relacionadas.
6. Revisar regresiones y eliminar workarounds innecesarios.

## 84. Test naming

Usar nombres de comportamiento y resultado: `rejects cancellation when trade-in equipment was already sold`. Evitar números, nombres de métodos privados o `works correctly` sin contexto.

## 85. Test organization

Unit/component specs viven junto al source propietario con sufijo `.spec.ts`/`.spec.tsx`. Suites que levantan infraestructura se separan por intención bajo áreas `test/integration/database`, `test/integration/api`, `test/integration/security`, `test/integration/concurrency`; E2E vive en un workspace/directorio raíz dedicado. Mantener una convención por app.

## 86. Backend test structure

Convención recomendada: specs unit/application colocados junto al archivo o use case, por ejemplo `modules/sales/application/confirm-sale.spec.ts`. Esto mantiene ownership y navegación. No crear `__tests__` paralelos por módulo salvo limitación futura de tooling documentada.

## 87. Integration suite structure

Separar suites database, API, security y concurrency; dentro, agrupar por feature/invariant. Compartir solo lifecycle PostgreSQL, autenticación y factories mínimas. Evitar un único archivo E2E/backend que acumule todas las operaciones.

## 88. Test database lifecycle

El job provisiona PostgreSQL efímero; cada worker crea su database, aplica migrations reales una vez y valida roles/RLS. Antes de cada test o scenario se hace reset/truncation controlada sobre tablas conocidas y luego se crean precondiciones. Al final se cierra pool y destruye database/instancia. No usar `db push`; migrations se prueban como artefacto.

## 89. Seed in tests

Ningún test depende del development seed. Cada caso crea Organization, User, Membership y datos mínimos mediante factories. Un seed de demo puede tener verificación propia, pero no es precondición de la suite.

## 90. Snapshot testing

Usar con moderación para contratos pequeños y estables cuyo diff sea revisable. No snapshotear páginas completas, JSON enorme, SQL generado o errores variables como sustituto de assertions. Toda actualización de snapshot requiere explicar y revisar el cambio.

## 91. Visual regression testing

No es requisito inicial. Puede incorporarse cuando exista Design System estable para primitives y páginas críticas, con baseline revisado y tolerancia consciente. No será gate V1 antes de contar con ownership y bajo ruido.

## 92. Performance testing

Antes de producción ejecutar pruebas simples y repetibles de listado representativo, confirmación de Sale, búsquedas clave y dashboard cuando exista. Registrar dataset, entorno, concurrencia y percentiles; no usar un benchmark de laptop como SLA. Investigar queries, pool y locks ante regresiones evidentes.

## 93. Load testing

Es requisito antes del primer despliegue productivo: escenarios moderados con 10, 20 y 40 usuarios concurrentes, alineados con la escala prevista. Usar staging aislado y datos sintéticos para detectar agotamiento de pool, lock contention, slow queries, límites API y errores; no buscar millones de requests ni ejecutar contra production.

## 94. Concurrency load scenarios

Incluir ventas independientes, contención sobre el mismo Equipment, último stock de Accessory y list/search mientras ocurren mutations. Las operaciones en conflicto pueden degradar a error controlado, pero nunca romper invariantes, producir partial effects o agotar indefinidamente conexiones.

## 95. Performance acceptance

No se fija aún un SLA empresarial arbitrario. Objetivo inicial: acciones administrativas comunes deben responder de forma estable y sentirse rápidas bajo dataset y 10–40 usuarios representativos; no debe haber pool exhaustion, crecimiento de errores ni locks prolongados. Registrar baseline/percentiles y definir umbrales numéricos en Performance/Production Readiness con evidencia.

## 96. Security testing

Además de tests de feature, planear dependency/secret scans, matriz de access control, tenant isolation, CSRF, upload validation, session abuse y rate limiting. Evaluar penetration test externo antes de mayor escala comercial o exposición/riesgo significativo; no reemplaza regresiones automatizadas.

## 97. OWASP regression tests

Toda vulnerabilidad corregida de una clase automatizable deja una regresión en la capa más baja confiable. Ejemplo: un IDOR produce test API negativo cross-tenant; bypass CSRF produce test de mutation sin token/Origin. Referenciar el riesgo sin incluir exploit o secret sensible.

## 98. Manual exploratory QA

Antes de releases relevantes explorar la feature nueva, flujos adyacentes, datos inesperados, estados de error/loading, responsive, teclado y permissions. Mantener checklist proporcional y registrar defectos reproducibles. QA manual complementa, no sustituye, automatización crítica.

## 99. Feature test plan

Antes de implementar una feature, documentar un mini plan:

### Happy paths

Resultados principales esperados.

### Domain failures

Precondiciones e invariantes que deben rechazar.

### Authorization

401, 403, permissions y campos controlados.

### Tenant

Scope y casos cross-tenant negativos.

### Database constraints

Garantías que necesitan PostgreSQL real.

### Concurrency

Carreras posibles y postcondiciones.

### UI states

Loading, error, empty, pending, responsive y accessibility.

### Regression risks

Áreas vecinas que podrían romperse. Las categorías no aplicables se marcan como tales con una razón breve.

## 100. Definition of Done integration

Las Definitions of Done de backend y frontend incorporan este documento. Una feature no se acepta por “funciona en mi navegador”: debe clasificar riesgo, ejecutar capas proporcionales, cubrir negativos/tenant/concurrency cuando correspondan y reportar resultados.

## 101. AI/Codex test rules

Cuando Codex implemente una feature debe:

- leer TESTING y fuentes de dominio aplicables;
- clasificar riesgo y proponer tests antes de código Critical;
- no eliminar tests fallidos sin causa explicada;
- no debilitar assertions ni actualizar snapshots automáticamente para obtener verde;
- no mockear la invariante bajo prueba;
- no sustituir PostgreSQL por fake/SQLite cuando su comportamiento importa;
- no usar `sleep` para races o flakes;
- ejecutar la suite proporcional y reportar comando/resultado exactos;
- preservar cambios ajenos y detenerse al completar el alcance.

## 102. AI regression discipline

Ante un bug, Codex intenta primero una reproducción automatizada y sigue red → green cuando sea práctico. No aplica el patch y luego escribe un test que solo confirma la nueva implementación. Si la reproducción no puede automatizarse, explica el límite y conserva pasos deterministas.

## 103. Test maintainability

Aplicar claridad, factories simples, duplicación intencional pequeña y nombres explícitos. Extraer helpers solo cuando estabilizan intención repetida; evitar abstraction excesiva y frameworks caseros. Un test debe poder entenderse sin navegar muchas capas.

## 104. Test anti-patterns

- Probar detalles de implementación.
- Fixture global gigante o DB mutable compartida.
- SQLite/fake como sustituto de PostgreSQL.
- Mockear cada dependencia.
- Obsesión por 100% coverage.
- Snapshots en todas partes.
- `sleep` para concurrencia o timing.
- Dependencia de orden, red/servicios productivos o datos reales.
- Flakes ignorados o retries que esconden bugs.
- Debilitar el test para hacerlo pasar.
- Omitir negativos de autorización/tenant.
- Cubrir solo happy paths en flujos Critical.
- Repetir toda la pirámide en E2E.

## 105. Required tooling decisions

| Área | Decisión V1 | Justificación y límite |
|---|---|---|
| Backend unit/application | **Vitest** | Unifica runner TypeScript en el monorepo y ofrece mocks, fake timers, projects y ejecución paralela. NestJS es runner-agnostic; sus testing utilities siguen disponibles. |
| Frontend unit/component | **Vitest + React Testing Library + user-event** | Comparte pipeline Vite y prueba DOM desde perspectiva del usuario. No probar internals React. |
| Network mocking frontend | **MSW** | Intercepta en la frontera HTTP y evita mockear hooks/clientes. Solo tests/dev explícito, nunca fallback production. |
| API integration | **Vitest + app NestJS real + cliente HTTP de test** | Verifica protocolo, guards, filters y DB; la librería HTTP concreta se decide al implementar si no existe ya. |
| Database | **PostgreSQL real efímero** mediante infraestructura de contenedor/servicio test | Reproduce constraints, RLS, locks y precisión. Testcontainers es candidato recomendado local/CI, no dependencia adoptada todavía. |
| E2E | **Playwright Test** | Browser isolation, TypeScript, trazas, paralelización y Chromium/Firefox/WebKit en una herramienta. |

No se adopta Jest para backend V1: aunque es el default documentado de NestJS, mantener Vitest en ambas apps reduce runners y convenciones; si una incompatibilidad real de Nest tooling aparece, requiere revisión documentada, no dos stacks preventivos.

## 106. Test command strategy

Comandos conceptuales futuros, sin crear scripts ahora:

- `test`: suite rápida por defecto (unit/component según workspace).
- `test:unit`: unit/application puras.
- `test:integration`: database/API/security/concurrency seleccionables.
- `test:e2e`: Playwright.
- `test:watch`: feedback focalizado local.
- `test:coverage`: medición diagnóstica sin sustituir gates.

El monorepo podrá filtrar por app/feature y ofrecer un comando agregado, manteniendo nombres consistentes.

## 107. Test execution speed

Unit/component deben tardar segundos mientras el proyecto sea pequeño. Integration y E2E son suites separables; un desarrollador ejecuta la capa afectada sin levantar todo para un cambio trivial. CI ejecuta alcance proporcional y main/release las capas amplias. Medir duración y atacar tests lentos por lifecycle, no eliminando garantías.

## 108. Quality gates by task

| Cambio | Gates mínimos |
|---|---|
| Solo documentación | Review, formatting/links si existe tooling; no app tests. |
| Componente frontend | Format, lint, typecheck, component/integration relevante y Web build. |
| Contrato/API | Typecheck, unit, API contract/integration, consumidores afectados y build. |
| DB migration | Migration empty/latest + upgrade si sensible, DB integration, RLS/constraints y API afectada. |
| Lógica de Sale/Inventory | Unit, PostgreSQL integration, API y concurrency; E2E crítico cuando corresponda. |
| Auth/security | Security integration, negativos 401/403/404, tenant/RLS/CSRF y regresión específica. |
| Dependencia/tooling | Lockfile, build, suites afectadas y security/license review futura. |

## 109. Traceability

Para capacidades Critical mantener una tabla liviana `Domain Invariant → Test Scenario → test/spec` en el plan de feature, documento o descripción de PR. No adoptar una plataforma pesada de requirements. La matriz de la sección 6 es el índice inicial y debe actualizarse cuando aparezcan invariantes.

## 110. Testing maturity roadmap

### Foundation

Instalar/configurar tooling en tarea autorizada, helpers mínimos y primeras pruebas de auth, RLS, tenant y constraints Critical.

### First Feature

Agregar unit, DB/API integration y frontend tests específicos del módulo; concurrency si toca stock/estado/idempotencia.

### Production Candidate

Completar matriz cross-tenant, carreras críticas, migrations, key E2E, smoke y carga de 10/20/40 usuarios en staging.

### Growth

Ampliar regresión de performance/E2E según incidentes y uso; evaluar property/mutation/visual testing y seguridad externa con evidencia.

## Required decision verification

- Backend runner: Vitest.
- Frontend runner: Vitest.
- Component strategy: React Testing Library + user-event, conducta observable.
- Network mocking: MSW en frontera HTTP.
- Database: PostgreSQL real efímero; nunca SQLite.
- E2E: Playwright Test.
- DB isolation: database por worker, migrations reales y truncation controlada.
- CI layers: static, unit/component, DB/API/security/concurrency, build y E2E selectivo.
- Concurrency: operaciones simultáneas coordinadas, múltiples conexiones y postcondiciones.
- Tenant isolation: RLS con runtime role más negativos API cross-tenant.
- Coverage: métrica diagnóstica, no objetivo porcentual único.
- Load: obligatorio en staging con 10, 20 y 40 usuarios antes de producción.
- Regression: bug importante deja test cuando sea razonable; Critical tiene prioridad.

## Additional reviews

La estrategia es consistente con los documentos y ADRs vigentes. No modifica arquitectura, schema, controles de seguridad ni estándares de implementación.

- `Architecture Review Required`: No.
- `Database Review Required`: No.
- `Security Review Required`: No.
- `Backend Review Required`: No.
- `Frontend Review Required`: No.

Una implementación futura que cambie RLS, isolation/locks, sesión, contratos, tooling frontend/backend adoptado o entorno PostgreSQL debe activar la revisión correspondiente.

## Final review

Se revisaron las 30 Global Domain Invariants y su cobertura representativa; constraints, migrations, RLS, rol runtime, cross-tenant, auth/CSRF, permisos, idempotencia y files; reglas backend/frontend; carreras Equipment/Sale/Reservation/Accessory/WAC/cancellation; sesgo de happy path, E2E redundante y DB behavior mockeado. La carga de 10–40 usuarios queda como gate explícito preproducción. No se encontraron contradicciones.

## Technical references

- NestJS, “Testing”.
- Vitest, “Features” y documentación de mocking.
- Testing Library, “React Testing Library” y “user-event”.
- Mock Service Worker, documentación oficial.
- Playwright, documentación de instalación, browsers, paralelización y TypeScript.
- PostgreSQL, documentación de transaction isolation, explicit locking y row security.
- Testcontainers for Node.js, módulo PostgreSQL.
