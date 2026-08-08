# BCM SOFT — Backend Engineering Standards

**Estado:** Completed  
**Fase:** BCM-006 — Backend Engineering Standards

Estándares obligatorios para implementar posteriormente el backend Node.js/TypeScript/NestJS de BCM SOFT. Este documento define límites, responsabilidades y criterios verificables; no contiene implementación, endpoints definitivos ni dependencias instaladas.

## Resumen de decisiones

| Área | Estándar V1 |
| --- | --- |
| Arquitectura | modular monolith; API pública interna por módulo |
| Capas | Presentation → Application → Domain; Infrastructure implementa ports |
| TypeScript | `strict`; `any` y assertions inseguras prohibidos salvo excepción revisada |
| Controllers | adapters HTTP delgados, sin negocio ni Prisma |
| Use cases | una intención clara; coordinan auth, transaction, repositories, audit/idempotency |
| Repositories | orientados al dominio, tenant-aware; sin `BaseRepository<T>` universal |
| Prisma | una instancia por proceso, encapsulada en Infrastructure |
| Transactions | Unit of Work explícito; context opaco para Application, Prisma solo Infrastructure |
| RLS | contexto Organization transaction-local; fail-closed |
| Authorization | permission central + policy contextual; deny-by-default |
| Validation | Transport + Domain + PostgreSQL, con responsabilidades distintas |
| Errors | taxonomía interna agnóstica de HTTP; mapping único en Presentation |
| Audit | port reusable invocado desde Application y transaccional cuando protege el hecho |
| API | REST `/api` inicialmente; commands explícitos para transitions |
| Pagination | offset en catálogos pequeños; keyset en historia/ledgers; máximo 100 |
| Tests | unit para reglas puras; integration real para PostgreSQL/RLS/locks |
| Dependencies | mínimas, justificadas, mantenidas y revisadas |

## 1. Backend philosophy

- simple before clever;
- explicit before magical;
- módulos cohesivos y cambios pequeños/revisables;
- cada business rule tiene un único owner;
- backend authoritative y database integrity respetada;
- secure/tenant-safe by default;
- abstractions y dependencies solo ante necesidad real;
- claridad, baja complejidad y responsabilidades correctas por encima de minimizar líneas.

## 2. Strict TypeScript

`strict: true` es obligatorio. También se habilitan `noUncheckedIndexedAccess` y `useUnknownInCatchVariables`; `exactOptionalPropertyTypes` se adopta desde el inicio salvo incompatibilidad documentada del stack.

- `any` explícito/implícito, casts dobles, `as unknown as`, non-null assertions y index access no verificado están prohibidos por defecto;
- toda excepción se reduce al boundary mínimo, incluye razón y valida runtime data;
- `unknown` se estrecha mediante schema, type guard o discriminated union antes de usar;
- no se silencian errores con `@ts-ignore`; `@ts-expect-error` exige motivo y test del contrato externo;
- tipos modelan estados válidos cuando aporta seguridad, sin construir un type system incomprensible;
- inputs externos nunca se consideran seguros por haber sido anotados en TypeScript.

## 3. Backend module organization

```text
src/
├── modules/
│   ├── identity/
│   ├── organizations/
│   ├── authorization/
│   ├── catalog/
│   ├── pricing/
│   ├── inventory/
│   ├── customers/
│   ├── suppliers/
│   ├── sales/
│   ├── reservations/
│   ├── trade-ins/
│   ├── files/
│   ├── audit/
│   └── reporting/
├── common/
├── config/
├── infrastructure/
└── main.ts
```

La lista refleja ownership aprobado y no obliga a crear carpetas antes de la feature. Cada Nest module exporta una API/capability pequeña; sus providers no exportados son internos. Imports cross-module siguen el grafo de ARCHITECTURE.md y se validarán mediante tooling/tests cuando exista código.

## 4. Internal module structure

Para complejidad suficiente:

```text
module/
├── domain/
├── application/
├── infrastructure/
├── presentation/
└── module.ts
```

- Domain: entities/value objects/policies/invariants sin Nest/HTTP/Prisma.
- Application: use cases, ports y coordination.
- Infrastructure: repositories Prisma y adapters externos.
- Presentation: controllers, request/response DTOs y protocol mapping.

No se crean carpetas vacías, interfaces decorativas ni mappings sin divergencia real. Architecture scales with actual complexity.

## 5. Controllers

Controller = HTTP adapter. Puede extraer parámetros ya validados y Authenticated Context, invocar un use case y mapear su result/headers/status.

No contiene reglas, queries Prisma/raw SQL, transactions, cálculos de stock/profit, tenant ownership, role conditionals, state machines, audit manual ni try/catch repetitivo. Guards/pipes/interceptors resuelven concerns HTTP transversales, pero la autorización del caso de uso vuelve a verificarse en Application.

## 6. Application services / use cases

Un use case representa una intención: `ConfirmSale`, `CancelSale`, `ReserveEquipment`, `ConvertReservationToSale`, `AdjustAccessoryStock`. Recibe command/query tipado y contexto mínimo.

Coordina permission/policy, idempotency, Unit of Work, domain rules, repositories, Audit y side-effect intent. No se crea un `SalesService` god object; al crecer, se divide por capability/use case. Application no conoce request/response HTTP ni importa Prisma types.

## 7. Domain logic

Domain posee lenguaje y reglas centrales: transitions, disponibilidad, reversibilidad, Money calculations e invariants. Una regla no se replica en controller/frontend/repository. Frontend puede anticiparla para UX, pero el backend la ejecuta y PostgreSQL refuerza invariants finales.

Domain no hace I/O ni depende de clock/random global si estos afectan una regla: recibe el valor/port necesario.

## 8. Domain entities vs Prisma models

Prisma model representa persistence; no es automáticamente Domain Entity. Para CRUD simple puede mapearse de forma liviana. Se introduce un modelo/domain mapping separado cuando protege invariants, evita estados inválidos, desacopla Decimal/status/snapshots o impide filtrar persistence internals. No se mapea por ceremonia.

Tipos Prisma no cruzan el public API del módulo, Application/Domain ni response contracts.

## 9. Repository pattern

Repositories existen cuando encapsulan persistence, tenant scope, locking/query semantics o testability. Son orientados al dominio: `findAvailableById`, `lockForSale`, `searchPage`, `saveConfirmedSale`; no wrappers CRUD 1:1 ni `BaseRepository<T>` mágico.

Una signature expresa scope y expectativa: recurso tenant-owned nunca expone ambiguamente `findById(id)`. No se agregan métodos sin consumidor real. Read projections complejas pueden usar Query Services en vez de forzar aggregates.

## 10. Prisma boundaries

Prisma Client se importa solo desde infrastructure database, repository implementations, migrations futuras y transaction coordinator. Está prohibido en controllers, Domain, frontend, shared packages o módulos consumidores.

El acceso raw se encapsula junto al repository/capability propietario. Rules/lint futuras deben impedir imports fuera de allowlist. Prisma errors/types se traducen en el boundary; no forman contratos públicos.

## 11. Prisma singleton / lifecycle

Existe una instancia controlada de Prisma por proceso de API, provista por un Infrastructure/Database module y reutilizada por repositories. Nunca un client por request/use case/repository. Bootstrap conecta o verifica según estrategia operativa; graceful shutdown cierra Prisma una vez. Tests pueden crear lifecycle aislado por suite/worker sin copiar el patrón productivo indiscriminadamente.

## 12. Queries

Toda query declara tenant/contexto, filtros, order estable, pagination/bounds y campos necesarios. Se revisan indexes de DATABASE.md, cardinalidad, query plan cuando sea crítica y N+1.

Preferir `select` explícito cuando reduzca datos o excluya internals. `include` se usa con relaciones necesarias y acotadas, nunca `everything`. Una query no devuelve filas ilimitadas ni acepta fragmentos Prisma construidos por el cliente.

## 13. N+1 prevention

No cargar lista y consultar cada elemento en loop. Usar select/join controlado, batch por IDs, aggregates o preload acotado. Antes de ampliar un único payload, medir cardinalidad y responder solo lo necesario. Integration tests/profiling de queries críticas deben detectar crecimiento O(n) de round-trips.

## 14. Tenant-scoped persistence

Todo repository tenant-owned requiere `OrganizationId` explícito o una instancia/query context ya ligada a Organization. Métodos globales se reservan para Identity/bootstrap y se nombran como tales.

Scope se aplica en `where`, relaciones tenant-aware y RLS; ninguno reemplaza al otro. Reportes cross-tenant no usan repositories normales y requieren capability de plataforma futura.

## 15. Organization IDs from client

`organizationId` en body/path/header solo puede seleccionar una Organization. Auth/session + User + Membership Active autorizan y construyen Current Organization Context. Nunca se pasa el valor raw directo al repository. Cambiar Organization usa un command explícito, revalida Membership y actualiza Session como define SECURITY/DATABASE.

## 16. Transactions

Una transaction se usa para una unidad atómica real, no automáticamente por endpoint. Es obligatoria para confirmar/cancelar Sale, Sale con Trade-In, Reservation create/cancel/convert, stock/WAC, recovery token consumption y otros catálogos de DATABASE.md.

Las lecturas tenant-owned bajo RLS sí requieren una **persistence scope transaction** breve para fijar contexto local; esto no las convierte en business transactions ni autoriza agrupar trabajo arbitrario.

## 17. Transaction boundaries

Application use case define la frontera. Un `UnitOfWork`/`TenantPersistenceScope` ejecuta callback y entrega un contexto opaco o bundle de repositories transaction-scoped. Solo Infrastructure adapta ese contexto a `Prisma.TransactionClient`.

```text
Application Use Case
  → UnitOfWork.run(organizationContext, callback)
      → set tenant context transaction-local
      → transaction-scoped repositories
      → commit / rollback
```

No se usa request global/AsyncLocalStorage oculto como única fuente de transaction o tenant. Domain nunca recibe Prisma client. Isolation/max wait/timeout se eligen por operación y se documentan contra DATABASE.md.

## 18. No network calls inside critical DB transactions

No email, object storage, HTTP, provider SDK, upload ni trabajo CPU lento mientras hay locks. La transaction persiste primero el estado y Audit requerido. Side effects ocurren después del commit con failure/retry observable. Si un efecto debe ser durable, requiere diseño persistente explícito futuro; `fire-and-forget` no es solución.

## 19. Lock ordering

Orden base: agregado coordinator (Sale/Reservation), counter si aplica, Equipment por UUID ordenado, Accessory Products por UUID ordenado, Trade-In/received Equipment y ledgers/audit. Cada use case documenta desviaciones.

No adquirir locks en orden de input del usuario. Deadlock conocido produce retry limitado solo si la operación es idempotente/segura; no loop infinito.

## 20. Concurrency

Check y mutation críticos comparten transaction. Según DATABASE.md se usan row lock, conditional update, UNIQUE/CHECK, idempotency y status revalidation. No read-now/update-later fuera de scope. El perdedor recibe Conflict seguro; no se “arregla” stock/estado en memoria.

## 21. Idempotency

Confirm/cancel Sale, Reservation critical commands y stock commands usan idempotency persistence. Authorization, tenant y request validation ocurren antes de devolver replay. La key se liga a Organization, operation y request hash; payload distinto es Conflict. El frontend deshabilitando botones es solo UX.

## 22. Validation layers

| Layer | Responsabilidad |
| --- | --- |
| Transport | shape, tipos, format, lengths, allowlists |
| Application/Domain | permission context, state, business relations/invariants |
| PostgreSQL | NOT NULL, FK, UNIQUE, CHECK, RLS y atomicity final |

No se copia toda regla en todas las capas. Cada una produce un fallo estable sin depender exclusivamente de Prisma types.

## 23. DTOs

Request DTO contiene solo campos editables por ese command; rechaza mass assignment de Organization, role, actor, stock, status, snapshots o timestamps server-controlled. Response DTO expone contrato mínimo y serializa Decimal/date/IDs conscientemente. Prisma models no son DTOs.

Command DTO interno puede diferir del request para incluir Authenticated Context y values normalizados; nunca incluye el request completo.

## 24. Validation library

La dependencia exacta se decide al crear el backend comparando integración Nest, inferencia/type safety, mantenimiento y comportamiento de transform. Sea class-validator/class-transformer u otra:

- whitelist explícita y rechazo de campos inesperados en commands sensibles;
- coercion/transform solo declarada, nunca conversión mágica global peligrosa;
- nested validation y límites de arrays/strings;
- mensajes públicos seguros y códigos estables;
- schema de runtime para todo input externo.

## 25. Command/query separation

Commands cambian estado y expresan intención; Queries leen/proyectan. No se instala framework CQRS ni event bus por esta distinción. Naming, DTOs y handlers separados cuando reduzcan acoplamiento; módulos pequeños pueden usar clases simples enfocadas.

## 26. Query services

Read models, dashboard, price list y reporting pueden usar Query Services especializados y projections eficientes sin reconstruir Domain Entities completas. Siguen permission, tenant/RLS, pagination, response minimization y ownership. No mutan estado ni se convierten en bypass de module boundaries sin documentar su read-only exception.

## 27. Error taxonomy

Taxonomía interna estable:

- `ValidationError`: contrato/input inválido;
- `AuthenticationError`: identidad/session ausente o inválida;
- `AuthorizationError`: identidad válida sin permission;
- `NotFoundError`: recurso no disponible en el scope;
- `ConflictError`: unicidad/concurrency/idempotency conflict;
- `DomainRuleViolation`: regla funcional rechaza la operación;
- `InfrastructureError`: dependencia/persistence inesperada.

Errores son clases/results tipados, no strings. Domain no lanza Nest HTTP exceptions. Infrastructure traduce errores Prisma conocidos sin filtrar internals; unknown queda Infrastructure/Unexpected y preserva `cause` solo internamente.

## 28. HTTP status mapping

| Error | HTTP |
| --- | --- |
| malformed/transport validation | 400 |
| unauthenticated/session invalid | 401 |
| permission denied dentro del tenant | 403 |
| missing o recurso cross-tenant no revelable | 404 |
| concurrency/duplicate/idempotency/domain state conflict | 409 |
| rate limit | 429 |
| unexpected/infrastructure | 500/503 según disponibilidad |

`422` no se usa en V1: domain validation consistente va a 400 o 409 según si input es inválido o colisiona con estado actual. Revisar solo si un contrato futuro obtiene claridad real.

## 29. Safe error responses

Contrato conceptual:

```text
{
  code,
  message,
  details?,
  requestId
}
```

`details` es allowlisted, field-level y sin existencia cross-tenant. Nunca stack, SQL, Prisma code/message raw, paths, secrets, hashes, request bodies o connection info. Un exception filter/presenter central aplica mapping; no respuestas artesanales inconsistentes por controller.

## 30. Logging

Structured logger transversal; `console.log` no es logging productivo. Campos base: timestamp UTC, level, request/correlation ID, route template, method, status, duration y error code; User/Organization/session internal IDs solo cuando autorizados y útiles.

Redaction central cumple SECURITY.md: nunca credentials, cookies, tokens, hashes, Authorization, signed URLs o bodies sensibles. No serializar Error/request completos sin sanitizer. Domain no loguea cada paso; boundaries registran contexto y resultado una vez.

## 31. Audit integration

Audit es un port/capability del módulo Audit invocado por Application. Una acción sensible persiste actor, Organization, action, entity, reason, correlation ID y before/after allowlisted. Cuando audit prueba el mismo hecho comercial, se escribe en la misma DB transaction; fallo aborta la operación.

No interceptor genérico que audite todo request o capture DTOs completos. Query access sensible/export puede auditarse tras una policy explícita. Controllers no construyen Audit Records.

## 32. Authentication context

Tipo application-level inmutable:

```text
AuthenticatedContext
- userId
- sessionId
- organizationId
- membershipId
- role
- authorizationVersion
- correlationId
```

Puede existir un contexto pre-auth mínimo para login/recovery. Presentation construye el contexto desde providers ya validados; Application recibe este value, nunca Express/Nest request, cookie raw ni headers. Cada use case declara si requiere Organization.

## 33. Authorization

Permissions centralizadas (`sales.cancel`, `inventory.adjust`, etc.) se resuelven desde role/Membership; no `if role === Owner` dispersos. Un authorization port ofrece `requirePermission(context, permission)` y policies contextuales verifican ownership/estado.

Deny-by-default: permission desconocida, context incompleto, version stale o policy error deniega. El use case autoriza aunque controller/guard ya lo hizo. Guards sirven como primera barrera HTTP, no como única autoridad.

En mutations sensibles, la Membership Active y `authorizationVersion` se revalidan dentro del mismo Unit of Work antes del cambio para evitar un check/use gap con una revocación concurrente.

## 34. Sensitive operations

Cancel Sale, stock adjustment, membership/user management, settings/exchange changes, Audit read, manual resolution y sensitive export usan permission específica. Además exigen reason/audit/idempotency/transaction cuando SECURITY o Domain lo ordene. UI oculta no concede ni retira permission.

## 35. RLS transaction context

Antes de toda query protegida, Infrastructure abre una transaction corta y establece Current Organization con setting transaction-local parametrizado. El mismo transaction client ejecuta todas las queries/repositories del scope. No session-level `SET`, global variable ni conexión pooled con estado persistente.

Business transactions reutilizan ese mismo scope, no anidan otra transaction Prisma. Identity/global tables excluidas usan repositories expresamente nombrados y grants definidos en DATABASE.md.

## 36. RLS failure handling

Sin tenant, setting fallido, role incorrecto o policy ausente: fail closed y error interno/authorization seguro; nunca retry sin RLS. Startup/deployment assertions verifican runtime role cuando corresponda. Tests usan el role real y prueban context missing, connection reuse y read/write cross-tenant.

## 37. Raw SQL

Solo cuando Prisma no expresa lock, RLS context, partial/advanced behavior o query crítica. Debe ser parametrizado/TypedSQL, encapsulado en Infrastructure, documentar motivo/owner/result shape, seleccionar columnas mínimas y tener tests tenant/injection/query behavior.

`$queryRawUnsafe`/`$executeRawUnsafe` con input dinámico y concatenación de identifiers están prohibidos. Column/order allowlists se mapean a fragmentos estáticos mantenidos por código.

## 38. Money

JavaScript `number` no representa Money, Rate, WAC ni intermediate calculation. Domain/Application usa value objects `Money`, `ExchangeRate` y decimal arbitrario aprobado; la dependencia concreta se selecciona al fundar backend, con una sola implementación y tests de precision. Prisma Decimal se limita al persistence boundary y se mapea sin pasar por `number`.

HTTP serializa importes/rates como strings decimales canónicos; moneda es explícita. Persistencia respeta `numeric(19,2)`, `numeric(20,8)` y cálculo equivalente a `numeric(38,12)`. No redondear en pasos intermedios; boundaries/mode se fijarán al resolver DB-DEC-005/DOM-DEC-014.

## 39. Dates

Instantes se tratan en UTC y persisten `timestamptz`. El timezone del servidor no decide reglas. Business dates/display usan IANA timezone de Organization de forma explícita. DTOs aceptan/emiten ISO 8601 con offset/UTC según contrato; dates inválidas se rechazan. Clock inyectable para reglas/test; `Date.now()` disperso está prohibido en Domain.

## 40. State transitions

Status críticos cambian solo mediante commands semánticos (`reserveEquipment`, `confirmSale`, `sendUnderReview`), no PATCH genérico con `status`. Use case verifica permission, current state y invariants dentro de transaction; Domain expresa transition y DB refuerza values/concurrency.

## 41. Historical fields

Sale snapshots, final prices, costs, exchange rates, quantities confirmadas, Trade-In values y WAC histórico no aparecen en update DTO genérico. Corrección extraordinaria requiere command separado, permiso, reason, before/after y Audit, preservando original conforme DOMAIN/SECURITY.

## 42. CRUD boundaries

CRUD simple es válido para catálogos/notas/configuración sin lifecycle complejo, siempre tenant-safe/audited cuando aplique. Confirm/cancel Sale, Trade-In, Reservation conversion y stock adjustment son processes con commands explícitos; un generic CRUD controller/service no los implementa.

## 43. Functions

Funciones/métodos tienen una intención y nivel de abstracción coherente. No existe límite rígido, pero mezclar validation, DB, calculation, network, audit y response mapping indica responsabilidades múltiples. Extraer por conceptos reales, no para alcanzar una métrica.

## 44. Services size

Señales: demasiadas razones de cambio, dependencias, domains/métodos no relacionados o tests con mocks masivos. Dividir por use case/capability y conservar un facade solo si es una API pública fina. No medir calidad por lines of code.

## 45. Duplication

Una business rule tiene una fuente. Código superficialmente parecido puede permanecer separado si representa conceptos distintos. Se acepta duplicación pequeña temporal antes que una abstraction falsa; se extrae cuando semántica y cambio conjunto están demostrados. DRY no justifica acoplar módulos.

## 46. Helpers

No `utils.ts` global. Helpers tienen owner/purpose (`money`, `pagination`, `identifiers`) y viven en la feature si su semántica es local. Un helper no oculta I/O, tenant context o side effects bajo un nombre genérico.

## 47. Common module

`common/` contiene solo primitives transversales estables: error base/taxonomy, auth context contract, logging/correlation abstractions y pagination primitives. No domain models, repositories, services o business rules. Dos usos no bastan para mover algo; requiere significado realmente común y owner.

## 48. Shared package

`packages/shared` no recibe Prisma models, backend entities, domain services, environment config ni DB types. Puede contener contratos/versioned schemas o primitives verdaderamente compartidas con ownership explícito. Compartir un type no mueve autoridad del backend al frontend.

## 49. Dependency injection

Nest DI conecta dependencias reales: repositories, Unit of Work, external ports, logger, clock y ID/token generator donde testing/seguridad lo requieran. No interface por cada clase ni injection token sin boundary. Ports se justifican por proveedor externo, segunda implementación real, module boundary o test substitution de I/O; pure classes pueden instanciarse directamente.

## 50. Dependency rule

Un módulo consume providers/ports exportados por el owner; no importa archivos internos ni consulta sus tablas con Prisma. Reporting read-only puede recibir una excepción documentada, tenant-safe y testeada cuando una projection cross-module sea necesaria. No se reemplazan imports internos por HTTP: todo sigue en un proceso y transaction local.

## 51. Cross-module transactions

El use case coordinator (por ejemplo Sales) orquesta capabilities de Inventory/Trade-In/Audit bajo un Unit of Work compartido. Cada módulo conserva ownership y ofrece una operación compatible con transaction context; no expone tablas/client.

No distributed transaction, saga o HTTP interno. Si un boundary no permite atomicidad requerida, se revisa su API antes de debilitar la invariant.

## 52. Circular dependencies

`forwardRef` no es solución habitual. Un ciclo exige revisar ownership, extraer contract/value compartido o mover coordination a un application-level owner. Toda excepción `forwardRef` requiere rationale, alcance mínimo y issue/plan de eliminación; no se acumulan ciclos.

## 53. Events

Domain/application events internos se usan solo si expresan un hecho y reducen coupling. No event bus completo por defecto. Stock, snapshots, status y Audit requerido no dependen de eventual handlers: integran la misma transaction. Handlers post-commit no son fire-and-forget; fallos relevantes necesitan persistencia/retry diseñados.

## 54. External integrations

Email, object storage, WhatsApp, Mercado Libre, invoicing y proveedores futuros viven tras ports/adapters del módulo propietario. Domain no importa SDKs. Adapter traduce errors/timeouts/retries y no filtra provider types. Cambiar proveedor no reescribe business rules.

## 55. Object storage

Files module controla metadata, MIME/size checks, object keys, authorization y lifecycle. Signed URL/stream solo tras Authentication, Organization ownership y permission. Controllers no usan SDK ni aceptan storage key como authority. DB mutation y upload/delete externo no se simulan como una transaction; failure/reconciliation se diseña explícitamente.

## 56. Background jobs

Sin broker V1. Un job simple debe ser idempotente, bounded, observable, con lock/lease si puede superponerse, retry limitado y estado de fallo. Scheduled cleanup de seguridad puede ser un comando/proceso simple. Trabajo crítico no se lanza sin `await` ni queda solo en memoria; una necesidad durable mayor requiere tarea/decisión propia.

## 57. API conventions

- REST JSON/HTTPS, resources como nouns en plural y casing JSON `camelCase`;
- URLs `kebab-case` solo donde sea necesario; IDs opacos;
- commands para transitions: `POST /sales/:id/confirm`, no PATCH status;
- GET safe/sin side effects; PUT reemplazo idempotente solo si semántica real; PATCH parcial allowlisted;
- filters/pagination/sort consistentes;
- idempotency header requerido en commands definidos;
- timestamps ISO 8601 y decimal amounts como strings;
- error envelope de sección 29.

No se diseñan todos los endpoints en esta fase.

## 58. API versioning

V1 comienza bajo `/api` sin `/v1`: Web/API first-party se despliegan coordinadamente y no existe cliente público multi-version. Breaking changes requieren migración consciente y compatibilidad temporal cuando deployment lo necesite. Antes de soportar clientes independientes o contratos concurrentes, se adopta versionado URI `/api/v1` (o estrategia formal mediante ADR); no se introducen versiones decorativas.

## 59. Pagination contracts

Dos contratos explícitos alineados con DATABASE.md:

```text
OffsetPage: { items, page, pageSize, total }
CursorPage: { items, nextCursor, hasMore }
```

Default 25, maximum 100; cada endpoint puede fijar menor. Offset solo para catálogos/listas pequeñas; Sales/history/movements/audit usan keyset estable y cursor opaco. `total` no se calcula si el contrato cursor no lo promete. Invalid cursor/page produce ValidationError.

## 60. Filtering

Cada Query DTO define filters admitidos, tipo, longitud y combinaciones. No convertir querystring en Prisma `where`. Date ranges tienen máximo razonable por endpoint; tenant/authorization filters son server-controlled y no pueden ser removidos por input.

## 61. Sorting

Sort usa enum/allowlist pública mapeada a columnas/expressions estáticas y siempre agrega tie-breaker estable (normalmente ID). No interpolar nombres/dirección raw ni permitir sort por secrets/internals. Defaults coinciden con índice/pagination contract.

## 62. Search

Normalizar una vez según DATABASE.md, limitar longitud/cardinalidad y elegir exact/prefix strategy por recurso. No regex, full ORM filters ni wildcard arbitrario del cliente. Queries costosas tienen timeout/rate limit/pagination y se miden antes de añadir trigram/FTS.

## 63. Response mapping

No retornar Prisma objects ciegamente. Presenter/mapper elimina internals, aplica public naming, serializa Decimal/date y controla relations. Mapping liviano es válido para recursos simples; no crear mapper layers vacíos. Secrets, hashes, authorization/rate internals nunca aparecen.

## 64. No hidden side effects

Names expresan intent: `find`/`get`/`list` no mutan negocio. Mantenimiento oportunista (por ejemplo cleanup acotado) se nombra/documenta y no altera semántica observable del query. Constructors/getters no hacen I/O. Side effects aparecen en commands y se prueban.

## 65. Testability

Domain/application critical rules se prueban sin iniciar HTTP. Use cases dependen de ports pequeños para I/O real; no de globals/request. Nest API tests verifican protocol wiring aparte. PostgreSQL behavior se valida en database integration, no fake repositories que prometen semantics distintas.

## 66. Unit tests

Prioridad: Money/rates/rounding una vez definido, permissions mapping, state transitions, reversibility, validation helpers y pure policies. Tests describen comportamiento/invariant, no implementation calls. No mockear 15 collaborators para un trivial orchestrator; esa fricción indica design issue o pide integration test.

## 67. Integration tests

Alta prioridad con PostgreSQL real/test para FK/CHECK/UNIQUE parcial, numeric precision, transactions, Prisma mapping, RLS, locks, idempotency y cleanup conditional updates. Tests aplican migrations reales futuras y runtime role real. Fake/in-memory DB no prueba estas invariants.

## 68. Concurrency tests

Obligatorios: doble Sale del Equipment, Sale vs Reservation, dos Reservations, ventas del último Accessory, concurrent WAC intake, double cancellation e idempotent confirm. Se sincronizan requests para producir carrera real y verifican un winner, error esperado, no partial effects, movements exactos y stock no negativo.

## 69. Authorization tests

Por capability sensible: allowed; 401; 403; resource cross-tenant no accesible; Membership revoked/version stale; invalid Organization switch; fields server-controlled rechazados. Guards y use case policies se prueban; no solo happy path/role Owner.

## 70. Test data

Factories/builders pequeños crean estado mínimo válido y hacen Organization explícita. No mega seed compartido ni dependencia de orden. Cada test/suite aísla y limpia datos de forma segura; IDs/timestamps controlables. Fixtures inválidos se usan solo para probar constraints y se nombran.

## 71. Time in tests

Clock port para expiry, cancellation windows, tokens, sessions y business dates. Tests usan instant fijo/advance controlado, no sleeps ni reloj real. Integration puede fijar timestamps explícitos y comparar rangos solo cuando DB clock es lo probado.

## 72. Randomness in tests

ID/token generator ports solo donde determinism/secret generation es relevante. Production adapter usa CSPRNG/UUIDv7 aprobado; test adapter emite valores deterministas no productivos. Nunca feature flag que habilite randomness insegura en production ni token fijo en shared fixtures/logs.

## 73. Environment configuration

Config se carga y valida una vez en bootstrap mediante schema tipado: required fields, URL/enum/number bounds, environment consistency y prohibiciones productivas. Falta/invalidez termina startup con mensaje seguro antes de escuchar tráfico. No conexión/config discovery en first request.

## 74. Secrets

No passwords, DB credentials, cookie/CSRF keys, API/storage tokens o recovery secrets en código/config defaults/tests/logs. `.env.example` contiene names y valores ficticios. Production obtiene secret manager/provider environment según SECURITY; error nunca imprime valor.

## 75. Config access

`process.env` solo en config/bootstrap adapter. El resto recibe objetos de configuración validados y mínimos por DI. No global mutable config, fallback silencioso productivo ni feature leyendo variables con names duplicados. Secrets se distinguen de business settings persistidos.

## 76. Health endpoints

Liveness responde que el proceso/event loop está operativo sin llamar dependencias. Readiness verifica que la instancia puede atender, incluyendo conexión DB liviana y estado de shutdown; no query profunda ni mutation. Respuesta pública mínima (`status`) sin versions, SQL, credentials, hostnames o internals. Detalle diagnóstico solo en observability protegida.

## 77. Graceful shutdown

Ante signal/deployment: marcar not-ready, dejar de aceptar trabajo, dar ventana acotada a requests/transactions, detener schedulers y cerrar HTTP/Prisma/adapters una vez. No terminar a mitad de commit por rutina ni esperar indefinidamente. Nest lifecycle/shutdown hooks se integran en bootstrap y se prueban.

## 78. Request limits

Configurar límites explícitos por route class: JSON/body, query URL, arrays/bulk cardinality y uploads (10 MiB inicial según SECURITY). Defaults exactos de JSON/query se fijan con frontend/deployment antes de production; nunca unlimited. Rechazo temprano usa 413/400 seguro y no procesa body completo innecesariamente.

## 79. Timeouts

Todo HTTP/provider call futuro tiene connect/overall timeout y cancelación cuando soporte. Prisma interactive transactions declaran max wait/timeout por categoría y permanecen breves. Queries lentas se observan y optimizan; request deadline se propaga donde sea seguro. Timeout no dispara retry mutante sin idempotency.

## 80. Performance instrumentation

Instrumentation transversal mide request duration/status/error, query count/duration aggregate y external calls sin timers manuales dispersos. Correlation/trace context conecta layers. No log por fila/query en production por defecto ni labels de alta cardinalidad con Customer/IMEI. BCM-009 elegirá tooling y budgets.

## 81. Code comments

Comentarios explican por qué, invariant, trade-off, lock order, RLS/raw SQL o comportamiento externo no obvio. No narran sintaxis ni preservan código muerto. Si el comentario contradice código, el cambio actualiza ambos.

## 82. Documentation comments

Public module capabilities, ports complejos y contracts con preconditions/failure semantics pueden usar JSDoc/documentation. No JSDoc obligatorio para getter/trivial function. Documentar unit/precision, tenant expectations y transaction requirement cuando el type no alcance.

## 83. Naming

Usar ubiquitous language de PRODUCT/DOMAIN: `confirmSale`, `reserveEquipment`, `tradeInValue`, no `processData`, `itemHandler`, `doAction`. Command/query/error names expresan outcome. No sinónimos locales para el mismo concepto ni abreviaturas crípticas.

## 84. Boolean naming

`isActive`, `hasPermission`, `canCancel`, `shouldAudit`; preguntas positivas y semántica clara. Evitar `flag`, `value`, `statusBool`, doble negación y boolean parameters que cambian por completo una función: preferir command/options discriminados.

## 85. Avoid magic constants

Statuses, permissions, operation codes, limits repetidos y units tienen source of truth tipado/configurado. No string duplicado de permission. No crear constante por literal local obvio. Numbers llevan unit/nombre (`maxPageSize`, `sessionIdleMinutes`) y config validation.

## 86. No premature generic systems

Prohibidos sin tarea/ADR: universal workflow/entity engine, custom generic CRUD framework, dynamic rules/IAM engine, homemade repository framework/ORM/DI, metadata-driven business engine y event sourcing/CQRS completo. Implementar el caso actual con extension point solo donde una variación real ya existe.

## 87. Dependency introduction checklist

Antes de agregar package:

1. problema concreto y owner;
2. capacidad equivalente del stack;
3. mantenimiento/release/security posture;
4. transitive dependencies/install scripts;
5. runtime/build/bundle cost;
6. types/testability/licensing;
7. alternativa clara sin package;
8. removal/upgrade plan.

PR documenta respuesta. Lockfile change se revisa. Dependencia trivial o sin uso inmediato se rechaza.

## 88. Refactoring rules

Refactor dentro del scope necesario para entregar/corregir con seguridad. No reescribir módulos vecinos “de paso”. Deuda no bloqueante se documenta. Refactor behavior-preserving se separa del cambio funcional cuando reduce riesgo; tests caracterizan comportamiento antes si es incierto.

## 89. Root-cause fixes

Bug fix identifica origen, invariant rota y todos los paths afectados. Preferir constraint/policy/source of truth correcto frente a otro guard duplicado, fallback o compensación silenciosa. Corregir datos existentes requiere plan separado y seguro; no se esconde en runtime patch.

## 90. No silent catch

Todo catch traduce, compensa, reintenta conscientemente o propaga. Nunca catch vacío, `return undefined` ambiguo ni log-and-continue sobre fallo crítico. Cleanup secundario puede preservar error principal, pero registra outcome sanitizado y mantiene observabilidad.

## 91. Retry policy

Retry solo para fallos clasificados transitorios, con max attempts pequeño/configurado, backoff+jitter y logging/metrics. Mutations requieren idempotency o prueba de no ejecución. Validation/auth/domain conflict no se reintenta. Deadlock/serialization retry repite transaction completa, no un fragmento con estado stale.

## 92. Feature implementation workflow

1. leer docs/ADRs/AGENTS;
2. identificar use case, invariants y owner;
3. localizar implementation/source of truth existente;
4. planificar scope, contracts, permissions, tenant y failure modes;
5. diseñar migration/compatibility si corresponde;
6. implementar Domain/Application;
7. implementar repositories/transaction/RLS;
8. agregar Presentation adapter;
9. integrar authorization/audit/idempotency;
10. tests unit/integration/concurrency pertinentes;
11. ejecutar lint/typecheck/build/tests;
12. review security/performance/docs y reportar archivos.

No comenzar por controller ni generar skeletons no usados.

## 93. Backend Definition of Done

- [ ] strict types y contracts/mappers correctos;
- [ ] formatting/lint/typecheck/build pasan;
- [ ] unit/integration/API/concurrency tests según riesgo;
- [ ] tenant scope, RLS y cross-tenant case verificados;
- [ ] permissions/validation/mass assignment revisados;
- [ ] transaction/locks/idempotency/audit correctos;
- [ ] errors/logs/responses seguros;
- [ ] queries bounded, sin N+1/over-fetch evidente;
- [ ] migration compatible/revisada cuando aplica;
- [ ] docs/decisions actualizadas y cero secrets/dead code.

## 94. Code review checklist

### Architecture

- [ ] ¿Módulo/owner/layer correctos y public capability respetada?
- [ ] ¿Dependency direction válida, sin cycle/abstraction especulativa?

### Business

- [ ] ¿Regla en un source of truth, transition/invariants completas?
- [ ] ¿No crea estado imposible ni reescribe historia?

### Database

- [ ] ¿Tenant/RLS context, transaction, locks y idempotency correctos?
- [ ] ¿Query paginada/index-aligned, sin N+1/over-fetch/raw unsafe?

### Security

- [ ] ¿Authentication/permission/ownership y deny default?
- [ ] ¿Sin IDOR, mass assignment, secret/PII exposure?

### Maintainability

- [ ] ¿Naming/responsibilities claros, sin code/dependency innecesarios?

### Tests

- [ ] ¿Happy/failure/401/403/cross-tenant y concurrency si aplica?

## 95. AI / Codex-specific rules

Cuando Codex modifica backend:

- inspeccionar repository, docs y implementation real antes de proponer;
- buscar el source of truth/reuse existente; no asumir archivos/APIs;
- explicar causa raíz y plan antes de patch de bug;
- cambio mínimo enfocado; no reescribir módulo completo;
- no crear `service-v2`, `new-service`, `fixed-service` ni parallel path;
- modificar source of truth y eliminar dead code creado por el cambio;
- no compatibility layer/TODO salvo bloqueo real documentado con owner/trigger;
- no cambiar public contracts, schema, dependencies o reglas fuera de scope;
- no inventar business rules/architecture; registrar la decisión requerida;
- ejecutar verificaciones proporcionales y reportar exactamente archivos/resultados;
- preservar cambios ajenos y detenerse al completar la tarea pedida.

## 96. Change size

Preferir vertical slices pequeños y reviewables. Si requiere muchos módulos/decisiones, dividir por outcome sin romper atomicidad. No límite de líneas; modificar decenas de archivos no relacionados para una feature pequeña exige replantear scope.

## 97. Review before patching

Antes de corregir bug, registrar en plan/comentario de trabajo: causa demostrada, archivos/source of truth afectados, invariant rota, fix propuesto y tests que fallan antes/pasan después. No trial-and-error acumulativo ni patches apilados sin retirar intentos fallidos.

## 98. Database migrations in features

Todo schema change usa migration versionada coordinada con application. Nunca editar DB manualmente ni migration aplicada. PR explica locks/backfill/index/RLS/rollback-forward-fix y prueba empty + representative DB. Prisma schema no puede omitir SQL avanzado que sea parte del contrato PostgreSQL.

## 99. Backward compatibility

Con una versión coordinada no se agregan layers preventivas. Cuando old/new application coexistirán durante deploy, schema/API change usa expand → migrate/backfill → contract, con observability y retirada explícita. No drop/rename incompatible en el mismo deploy que deja consumidores antiguos.

## 100. Backend anti-patterns

Prohibidos:

- fat controllers y god services;
- Prisma everywhere o models como API;
- negocio en HTTP/repository/frontend;
- tenant ID confiado desde request o `findById(id)` ambiguo;
- CRUD genérico para processes;
- global utils/common dumping ground;
- circular modules/`forwardRef` arbitrario;
- `any`, unsafe casts y non-null assertions rutinarias;
- SQL concatenado/raw unsafe;
- listados sin bound, N+1 y over-fetch masivo;
- silent catch, infinite retry y fire-and-forget crítico;
- direct status mutation/historical overwrite;
- copy/paste de business rules;
- abstractions/dependencies especulativas;
- network call dentro de DB transaction;
- RLS context persistente en pool o fallback sin tenant;
- parches/compatibility layers acumulados indefinidamente.

## Required decision verification

| Required decision | Adopted standard |
| --- | --- |
| Module organization | feature modules con public API y capas proporcionales |
| Controllers | HTTP adapters delgados |
| Application/Domain | use case coordina; Domain posee invariants |
| Repositories/Prisma | domain-oriented repositories; Prisma solo Infrastructure |
| Transactions | Unit of Work explícito y tx context opaco |
| Tenant propagation | Authenticated Context + repository scope + RLS local |
| Authorization | centralized permission + contextual policy, deny default |
| Validation | Transport + Domain + PostgreSQL |
| Errors | taxonomía interna + mapping HTTP central |
| Logging/Audit | structured/redacted; Audit port transaccional selectivo |
| REST/versioning | commands semánticos; `/api` initially, version when needed |
| Pagination | offset small catalogs, keyset histories, max 100 |
| Testing | unit pure + PostgreSQL integration/API/concurrency |
| Dependencies/refactoring | evidence-based, scoped y reversible |
| AI-assisted coding | inspect, root cause, source of truth, minimal patch, verify |

## Review status

**Architecture Review Required:** No.  
**Database Review Required:** No.  
**Security Review Required:** No.

Los standards implementan las decisiones vigentes sin cambiar modular monolith, REST, Prisma, shared PostgreSQL multi-tenancy, RLS parcial, server-side sessions, RBAC, Money precision o infraestructura V1.

## Mandatory review result

Revisión contra PRODUCT, DOMAIN, ARCHITECTURE, DATABASE, SECURITY y todos los ADRs:

- Prisma está confinado a Infrastructure y lifecycle singleton;
- todo tenant access propaga contexto validado, repository scope y RLS transaction-local;
- Unit of Work permite atomicidad cross-module sin filtrar Prisma al Domain;
- permissions se centralizan y revalidan en use cases;
- Money nunca pasa por `number` y el redondeo pendiente no se inventa;
- locks, idempotency y tests concurrentes reflejan DATABASE.md;
- capas/ports se crean por complejidad real, sin Clean Architecture dogmática;
- reglas para Codex son concretas, verificables y detienen scope creep.

No se detectaron contradicciones ni revisiones adicionales necesarias.

## Technical references

- NestJS official documentation: Modules, Controllers, Providers, Validation y Lifecycle Events.
- Prisma official documentation: transactions, raw queries y Decimal fields.
- TypeScript official TSConfig reference: `strict`, checked indexed access y unknown catch variables.

Son referencias de capacidad; las decisiones responden al contexto de BCM SOFT.

## Completion status

**Estado:** Completed

BCM-006 define standards de implementación futura. No crea NestJS, Prisma, modules, endpoints, migrations, tests ni application code. BCM-007 permanece Pending.
