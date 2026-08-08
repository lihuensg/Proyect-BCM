# BCM SOFT — Architecture Definition

**Estado:** Completed  
**Fase:** BCM-003 — Architecture Definition

Este documento define la arquitectura técnica de BCM SOFT a partir de `PRODUCT.md` y `DOMAIN.md`. Está optimizada para el primer uso real de BCM, una carga inicial aproximada de 10–40 usuarios concurrentes y crecimiento posterior a cientos de usuarios sin reescribir el sistema.

No define tablas, columnas, índices, migrations, endpoints concretos, componentes visuales ni código de aplicación.

## Resumen de decisiones

| Área | Decisión V1 |
|---|---|
| Estilo de sistema | Modular Monolith |
| Repositorio | Monorepo |
| Backend | Node.js LTS + TypeScript estricto + NestJS |
| Frontend | React + TypeScript + Vite, como SPA administrativa |
| API | REST JSON sobre HTTPS |
| Base de datos | PostgreSQL |
| Multi-tenancy | Base compartida con identificación obligatoria de Organization |
| Autenticación | Sesión server-side con identificador opaco en cookie segura |
| Autorización | RBAC por Membership, backend deny-by-default |
| Acceso a datos | Prisma ORM, encapsulado por módulos, con SQL parametrizado controlado como excepción |
| Archivos | Object storage privado; metadata separada en PostgreSQL |
| Cache | Sin Redis ni cache distribuida inicialmente |
| Jobs | Sin broker ni worker separado inicialmente; punto de extensión futuro |
| Deployment | Web estática, API, PostgreSQL y object storage como unidades separadas |

## 1. Principio arquitectónico principal

### 1.1. Modular Monolith frente a Microservices

| Criterio | Modular Monolith | Microservices |
|---|---|---|
| Complejidad | Un proceso y límites internos explícitos | Límites de red, contratos distribuidos y coordinación operativa |
| Deployment | Una API versionada y desplegada como unidad | Múltiples artefactos, orden y compatibilidad entre despliegues |
| Transacciones | Una transacción PostgreSQL puede cubrir un flujo comercial completo | Requiere coordinación distribuida y consistencia eventual |
| Debugging | Un correlation ID y un flujo de ejecución principal | Trazas entre servicios y fallos parciales de red |
| Observabilidad | Logging, métricas y trazas básicas son suficientes | Requiere observabilidad distribuida desde el inicio |
| Costo | Bajo costo operativo y menos infraestructura | Mayor costo de runtime, red, automatización y soporte |
| Mantenimiento | Adecuado para un equipo pequeño y desarrollo asistido | Exige ownership y disciplina operativa por servicio |
| Evolución | Puede extraer módulos cuando exista evidencia | Permite independencia, pero fija distribución prematuramente |

### 1.2. Decisión

BCM SOFT V1 adopta un **Modular Monolith**. La API se despliega como una unidad, pero sus módulos tienen ownership, interfaces y dependencias controladas.

La decisión se justifica por:

- la escala inicial de 10–40 usuarios concurrentes;
- la necesidad de transacciones coherentes entre Sale, Inventory, Reservation y Trade-In;
- el bajo costo operativo requerido;
- la posibilidad de diagnosticar un flujo completo sin coordinación distribuida;
- el tamaño inicial esperable del equipo;
- la ausencia de workloads que necesiten escalado o despliegue independientes.

No se adoptan microservicios por una afirmación genérica de escalabilidad. Un módulo solo será candidato a extracción futura si demuestra necesidades sostenidas de escalado, aislamiento operativo, ownership independiente o ciclo de despliegue propio. La extracción requerirá un ADR nuevo.

La decisión formal está en `docs/adr/ADR-001-modular-monolith.md`.

## 2. Estructura general

```text
Browser
   |
   | HTTPS
   v
Web Application (React SPA)
   |
   | REST JSON / HTTPS
   v
Backend API (NestJS Modular Monolith)
   |                 |
   |                 +----> Private Object Storage
   |
   +----> PostgreSQL
   |
   +----> Future External Services through adapters
```

### 2.1. Web Application

- Presenta la interfaz administrativa y navegación interna.
- Mantiene estado de interfaz, formularios y cache de server state.
- Valida para mejorar la experiencia, sin convertirse en autoridad de seguridad o negocio.
- Nunca accede directamente a PostgreSQL ni a object storage privado.
- Consume únicamente contratos autorizados de la API.

### 2.2. Backend API

- Autentica, autoriza y resuelve el Current Organization Context.
- Es la autoridad final para validación y reglas de negocio.
- Orquesta transacciones y concurrencia.
- Accede a PostgreSQL y genera acceso autorizado a archivos.
- Emite logs técnicos y registros funcionales de auditoría.
- Encapsula proveedores externos detrás de adapters.

### 2.3. PostgreSQL

- Es el system of record para estado comercial, relaciones, historial, sesiones y metadata de archivos.
- Aplica integridad, unicidad y restricciones que no deben depender solo de supuestos de aplicación.
- No es accesible desde el navegador.
- Su esquema detallado pertenece a BCM-004.

### 2.4. File Storage

- Conserva fotografías y futuros documentos como objetos privados.
- No sustituye a PostgreSQL para metadata, ownership o referencias.
- Todo acceso del usuario se autoriza a través de la API.

### 2.5. External Services futuros

Integraciones futuras se conectan mediante adapters definidos por el módulo propietario. El dominio no depende directamente de SDKs o formatos de proveedores.

## 3. Repository Strategy

### 3.1. Alternativas

Repositorios separados ofrecen permisos y ciclos independientes, pero agregan coordinación de contratos, duplicación de tooling y cambios cruzados. BCM SOFT todavía requiere evolución vertical frecuente entre Web, API y documentación.

### 3.2. Decisión

Se adopta **monorepo** con la estructura base existente:

```text
bcm-soft/
├── apps/
│   ├── web/
│   └── api/
├── packages/
├── docs/
├── prompts/
├── infrastructure/
└── scripts/
```

Ventajas:

- cambios verticales revisables en una única unidad;
- documentación y ADRs junto al sistema que gobiernan;
- configuración consistente de lint, TypeScript y testing;
- CI puede detectar impacto entre aplicaciones;
- Codex puede inspeccionar el contexto completo sin perder límites.

Riesgos y controles:

- El monorepo no autoriza imports arbitrarios entre apps.
- Cada app conserva su runtime y dependencias.
- Los módulos del backend no se publican como lógica compartida del frontend.
- Los checks de arquitectura deben detectar dependencias prohibidas.
- `packages/` contiene paquetes intencionales, no un cajón de helpers.

La decisión formal está en `docs/adr/ADR-002-monorepo.md`.

## 4. Backend Technology

### 4.1. Evaluación

| Alternativa | Fortalezas | Riesgos para BCM SOFT |
|---|---|---|
| Node.js + TypeScript sin framework estructural | Control y superficie mínima | Convenciones, DI, validación y modularidad deberían diseñarse y sostenerse manualmente |
| NestJS sobre Node.js + TypeScript | Módulos, DI, testing, guards, pipes e integración consistente | Decorators y framework pueden usarse en exceso si invaden el dominio |
| Framework minimalista orientado a HTTP | Menor abstracción y buen rendimiento | Menos guardrails para un dominio transaccional con muchos módulos |
| Otro ecosistema backend | Puede ser técnicamente válido | Reduce coherencia TypeScript end-to-end sin necesidad demostrada |

### 4.2. Decisión

El backend utilizará:

- una versión LTS activa de Node.js al comenzar implementación;
- TypeScript en modo estricto;
- NestJS como framework de aplicación y HTTP;
- el adapter HTTP predeterminado de NestJS inicialmente, salvo evidencia de que otro adapter sea necesario.

NestJS aporta módulos encapsulados, dependency injection, validación de requests, testing y guards adecuados a un monolito modular. El Domain no debe depender de decorators, HTTP ni APIs específicas del framework.

No se elige por cantidad de líneas ni por performance teórica. Para la carga prevista, claridad, consistencia y testabilidad dominan. Las versiones exactas se fijarán y bloquearán al iniciar la implementación técnica.

## 5. Frontend Technology

### 5.1. Evaluación

- **React + Vite:** adecuado para una SPA administrativa, ecosistema amplio, TypeScript, build estático y arquitectura por features.
- **Framework full-stack con SSR:** útil para SEO o renderizado de contenido público, necesidades que BCM SOFT V1 no presenta.
- **Otros frameworks SPA:** técnicamente viables, pero no aportan una ventaja suficiente para cambiar la decisión.

### 5.2. Decisión

La Web utilizará **React + TypeScript + Vite** como Single Page Application administrativa.

Razones:

- la aplicación es autenticada e interna, sin requisito inicial de SEO;
- Vite separa un desarrollo rápido de un build estático desplegable;
- React permite composición por features y ecosistema de testing maduro;
- TypeScript mantiene contratos y estados explícitos;
- el frontend puede desplegarse como activos estáticos independientes de la API.

La navegación se resolverá en el cliente. La librería concreta de routing, formularios y server-state se fijará en Frontend Standards para evitar instalar herramientas antes de justificar su uso.

Responsive design es un requisito de evolución. El diseño visual pertenece a DESIGN_SYSTEM.md y FRONTEND_STANDARDS.md.

## 6. API Style

### 6.1. Evaluación

| Estilo | Ventajas | Costos |
|---|---|---|
| REST | Convenciones HTTP conocidas, cache/debugging simples, tooling amplio | Requiere disciplina en recursos, errores y evolución |
| GraphQL | Selección flexible y esquema consultable | Mayor complejidad de autorización, cache, consultas y observabilidad |
| RPC | Operaciones explícitas y contratos directos | Menor alineación con semántica HTTP y riesgo de API acoplada a implementación |

### 6.2. Decisión

V1 adopta **REST JSON sobre HTTPS**. GraphQL y RPC no resuelven una necesidad actual que compense su complejidad.

Convenciones:

- recursos y acciones de dominio con semántica HTTP consistente;
- un formato uniforme de éxito y error;
- códigos de error estables y legibles por máquina;
- paginación server-side para colecciones;
- filtros, búsqueda y ordenamiento expresados mediante parámetros documentados;
- límites máximos para páginas y payloads;
- operaciones sensibles con protección de idempotencia cuando corresponda;
- versionado explícito solo ante cambios incompatibles, manteniendo inicialmente una versión de contrato.

No se define en esta fase una lista de endpoints.

La decisión formal está en `docs/adr/ADR-005-rest-api.md`.

## 7. Modular Boundaries

| Módulo | Responsabilidad y ownership | Dependencias permitidas | Dependencias prohibidas |
|---|---|---|---|
| **Identity** | Credenciales, autenticación, sesiones y recuperación de acceso | Users, Audit mediante interfaces | Inventory, Sales o reglas comerciales |
| **Organizations** | Organization, Membership y Current Organization Context | Users, Audit | Datos comerciales internos de otros módulos |
| **Users** | Identidad funcional y perfil de User | Organizations para memberships | Stock, ventas o reglas financieras |
| **Authorization** | Policies, roles y permisos aplicados a Membership | Identity, Organizations | Decidir reglas de stock o venta |
| **Catalog** | Categorías, marcas, modelos, condiciones y otros catálogos | Organizations, Audit | Modificar inventario o historia comercial |
| **Pricing / Money** | Currency, Exchange Rate, Money, costos y cálculos base definidos | Organizations para configuración | Estado de Sale o Inventory |
| **Inventory** | Equipment, Accessory Product, disponibilidad, movimientos y costo de inventario | Catalog, Pricing / Money, Audit | Confirmar Sale o administrar Customer |
| **Customers** | Customer y su perfil actual | Organizations, Audit | Reescribir ventas o reservas históricas |
| **Suppliers** | Supplier básico | Organizations, Audit | Compras avanzadas todavía fuera de alcance |
| **Sales** | Sale, Sale Item, lifecycle, confirmación, cancelación y coordinación transaccional | Inventory, Customers, Pricing / Money, Organizations, Audit | Acceso directo a detalles internos no publicados de otros módulos |
| **Reservations** | Reservation, estado, conversión y cancelación | Inventory, Customers, Sales mediante casos de uso, Audit | Cambiar stock o Sale saltando interfaces públicas |
| **Trade-In** | Subdominio de Sales para recepción, valor de toma y relación de origen | Sales, Inventory, Customers, Pricing / Money | Operar como flujo independiente de una Sale |
| **Audit** | Audit Record funcional inmutable | Contexto de User y Organization | Sustituir logs técnicos o decidir operaciones de negocio |
| **Reporting** | Consultas y proyecciones de solo lectura para dashboard/listas | Interfaces de lectura autorizadas | Mutar estado de módulos operativos |

### 7.1. Reglas de colaboración

- Cada módulo publica casos de uso o ports explícitos; otro módulo no modifica directamente su información.
- Los flujos cruzados se orquestan en la capa Application dentro de una única transacción cuando corresponde.
- Reporting es de solo lectura.
- Trade-In permanece dentro del límite amplio de Sales para evitar un ciclo Sales ↔ Trade-In.
- Las dependencias circulares están prohibidas; si aparecen, se revisan ownership o interfaces.
- Los imports permitidos se validarán con reglas estáticas durante implementación.

## 8. Domain Ownership

Cada regla de negocio tiene un único propietario arquitectónico:

| Regla | Propietario |
|---|---|
| Si Equipment o cantidad puede venderse | Inventory |
| Lifecycle y confirmación de Sale | Sales |
| Lifecycle y titular de Reservation | Reservations |
| Costo específico y promedio ponderado | Inventory con tipos de Pricing / Money |
| Gross Profit USD | Pricing / Money, invocado por Sales/Reporting |
| Ingreso y reversibilidad de Trade-In | Sales / Trade-In, coordinado con Inventory |
| Cotización histórica | Pricing / Money y operación propietaria |
| Membership y contexto activo | Organizations |
| Permiso para ejecutar un caso de uso | Authorization |
| Registro funcional de acción sensible | Audit |

Un controller adapta HTTP; no es propietario del dominio. La Web puede anticipar restricciones para UX, pero la API vuelve a validarlas. Helpers de base no duplican decisiones de negocio.

### 8.1. Cobertura de invariantes del dominio

| Grupo de invariantes | Soporte arquitectónico |
|---|---|
| Organization independiente | Current Organization Context, scoping obligatorio, autorización backend, constraints/policies y tests cross-tenant |
| Equipment único y estados excluyentes | Inventory ownership, transacciones, constraints, concurrency control y movimientos trazables |
| IMEI único dentro de Organization | Validación de dominio más constraint de base a definir en BCM-004 |
| Stock de accesorios no negativo | Updates transaccionales/condicionales, constraint, locking y tests concurrentes |
| Moving Weighted Average Cost | Cálculo y actualización dentro de la misma transacción que el ingreso de stock |
| Sale atómica e idempotente | Transaction boundary en Application, constraints e idempotency persistente |
| Reservation única y venta al mismo Customer | Reservation ownership, lock/conflict sobre Equipment y autorización del caso de uso de conversión |
| Trade-In trazable y reversible | Orquestación Sales/Trade-In/Inventory, una transacción, Audit y `Manual Resolution Required` |
| Sale histórica no destructiva | Lifecycle explícito, adapters sin update genérico, correcciones/cancelaciones auditadas |
| Cancelación sin doble efecto | Idempotency y movimientos compensatorios relacionados con la operación original |
| Money y cotización histórica | Value objects explícitos, snapshots económicos y representación decimal definida en BCM-004 |
| Return/Exchange fuera de V1 | Sin casos de uso V1; conceptos preservados como extensión futura sin editar Sale histórica |

Ninguna de estas barreras sustituye a las demás: dominio, aplicación, persistencia y tests forman defensa en profundidad.

## 9. Multi-Tenancy

### 9.1. Estrategias evaluadas

| Estrategia | Seguridad y operación | Costo y evolución |
|---|---|---|
| Database por tenant | Aislamiento fuerte y backups separados | Migrations, conexiones y operación se multiplican por negocio |
| Schema por tenant | Separación lógica visible | Migrations y tooling complejos; muchos schemas dificultan operación |
| Shared database + tenant identifier | Un esquema y pipeline de migrations | Exige scoping obligatorio y defensa contra consultas sin tenant |

### 9.2. Decisión

V1 adopta **PostgreSQL compartido con identificación obligatoria de Organization** en toda información tenant-owned.

La estrategia permite comenzar con BCM como una sola Organization sin fijar el sistema a un único negocio. Mantiene una sola base, un solo esquema y un solo flujo de migrations, apropiado para el costo y escala iniciales.

Conceptos:

- **Organization:** propietario funcional de información comercial.
- **Membership:** relación entre User y Organization, con roles/permisos.
- **Current Organization Context:** Organization autorizada para la request actual, resuelta desde identidad y Membership.

No se definen columnas concretas. La decisión formal está en `docs/adr/ADR-004-shared-database-multitenancy.md`.

## 10. Tenant Isolation

Tenant isolation es un requisito de seguridad, no una convención opcional.

Defensa en profundidad:

1. La sesión identifica al User; el backend resuelve Membership y Current Organization Context.
2. La API no confía en un Organization ID enviado por la Web como prueba de autorización.
3. Los casos de uso reciben un contexto validado, no un identificador arbitrario.
4. Los adaptadores de persistencia aplican scoping de Organization por defecto.
5. Las restricciones y políticas de PostgreSQL actuarán como barrera adicional donde BCM-004/BCM-005 determinen que corresponde.
6. Tests de integración intentan accesos cruzados entre Organizations.
7. Logs y auditoría incluyen contexto de Organization sin exponer datos sensibles innecesarios.

La evaluación concreta de Row-Level Security se completa en Database Design y Security Architecture. No reemplaza autorización de aplicación.

## 11. Authentication

### 11.1. Alternativas evaluadas

- **Sesión server-side + cookie:** revocación y logout directos, credencial opaca fuera de JavaScript.
- **JWT persistido en navegador:** reduce estado de sesión del servidor, pero aumenta exposición ante XSS y complica revocación.
- **Access + refresh tokens:** útil para clientes múltiples o APIs externas; agrega rotación y estados de compromiso.
- **Proveedor externo:** puede ser futuro si requisitos de SSO o identidad lo justifican.

### 11.2. Decisión

V1 adopta **sesiones server-side** con identificador aleatorio opaco en una cookie `HttpOnly`, `Secure` y `SameSite` apropiada. La sesión se conserva inicialmente en PostgreSQL; no se introduce Redis para este fin.

Requisitos arquitectónicos:

- expiración absoluta y por inactividad;
- revocación en logout y ante eventos de seguridad;
- soporte conceptual para múltiples dispositivos y revocación por sesión;
- rotación de identificador tras autenticación o elevación sensible;
- protección CSRF para requests que modifican estado;
- cookies inaccesibles a JavaScript para reducir exposición ante XSS;
- recuperación de contraseña mediante tokens de un solo uso, expirables y revocables;
- respuestas de login que no faciliten enumeración de usuarios;
- proveedor externo como adapter futuro, sin acoplar el dominio.

Políticas concretas, tiempos y flujos se definen en BCM-005. La decisión formal está en `docs/adr/ADR-006-server-side-sessions.md`.

## 12. Authorization

Authentication responde quién es el usuario. Authorization responde qué puede hacer dentro de una Organization.

V1 adopta:

- Membership como vínculo User–Organization;
- RBAC inicial para agrupar permisos;
- policies backend por caso de uso;
- deny-by-default;
- least privilege;
- verificación de Current Organization Context en toda operación tenant-owned;
- auditoría para acciones sensibles;
- ausencia de decisiones de autorización basadas solo en controles visuales.

Los nombres y permisos exactos de roles se definen en BCM-005. La arquitectura permite añadir policies contextuales sin reemplazar el modelo completo.

## 13. Database Access Layer

### 13.1. Alternativas evaluadas

| Alternativa | Type safety / modelado | Queries y transacciones | Complejidad |
|---|---|---|---|
| Prisma | Client generado, schema explícito y migrations integradas | Transacciones y escape hatch de SQL parametrizado | Generación y abstracción propia; queries avanzadas requieren cuidado |
| Drizzle | Cercano a SQL y fuertemente tipado | Buen control SQL y transacciones | Más decisiones de acceso y mapping quedan en el equipo |
| TypeORM | Data Mapper/Active Record, decorators y transacciones | Amplio soporte y flexibilidad | Mayor runtime magic y riesgo de entidades acopladas a persistencia |
| SQL directo controlado | Máximo control y observabilidad | Excelente para PostgreSQL avanzado | Más mapping, boilerplate y disciplina manual |

### 13.2. Decisión

V1 adopta **Prisma ORM** para PostgreSQL.

Justificación:

- modelo de persistencia explícito y type-safe;
- migrations revisables;
- transacciones para workflows comerciales;
- buen soporte de Node.js/TypeScript y productividad con Codex;
- onboarding y navegación del esquema simples;
- posibilidad de SQL parametrizado controlado para queries que el ORM no exprese adecuadamente.

Controles:

- Prisma queda encapsulado en adapters/repositories de cada módulo;
- Domain y Application no exponen tipos generados por Prisma;
- no existe un repository genérico global;
- el client no se usa libremente desde controllers;
- SQL raw inseguro o construido con strings está prohibido;
- queries avanzadas se revisan, parametrizan, observan y prueban;
- migrations no se generan ni ejecutan en esta fase.

La decisión formal está en `docs/adr/ADR-007-prisma.md`.

## 14. Transactions

Requieren atomicidad, como mínimo:

- confirmar Sale;
- cancelar o revertir Sale;
- Sale con Trade-In;
- convertir Reservation a Sale;
- crear/cancelar Reservation y cambiar disponibilidad;
- ajustar múltiples elementos de inventario;
- actualizar stock y Moving Weighted Average Cost en un mismo ingreso;
- escribir Audit Record obligatorio junto con la operación sensible.

Principios:

- todos los efectos del caso de uso completan o ninguno completa;
- el application service define la frontera transaccional;
- llamadas de red o trabajo lento no se realizan dentro de la transacción;
- las transacciones se mantienen breves;
- los módulos colaboran mediante ports compatibles con la misma unidad de trabajo;
- no existen transacciones distribuidas en V1.

Los isolation levels y locks concretos se definen en BCM-004.

## 15. Concurrency

Riesgos principales:

- dos vendedores venden el mismo Equipment;
- venta y Reservation compiten por una unidad;
- dos Reservations compiten por un Equipment;
- ventas concurrentes consumen el último stock de un accesorio;
- confirmación o cancelación se envía dos veces;
- un ingreso concurrente altera el costo promedio de accesorios.

Estrategia general:

- revalidar invariantes dentro de la transacción;
- usar constraints de base como última barrera;
- aplicar locking de filas o updates condicionales en recursos disputados;
- usar optimistic concurrency cuando detectar cambios sea suficiente;
- serializar el cálculo que actualiza stock y costo promedio cuando corresponda;
- devolver un error de conflict entendible cuando otra operación ganó;
- probar carreras reales contra PostgreSQL.

La elección precisa por operación corresponde a BCM-004.

## 16. Idempotency

Operaciones sensibles:

- confirmación de Sale;
- cancelación/reversión de Sale;
- creación de Reservation;
- conversión Reservation → Sale;
- ajustes manuales;
- requests repetidas por doble click o retry de red.

Cada comando sensible debe aceptar o derivar una identidad idempotente dentro del contexto de Organization. Repetir la misma intención devuelve el resultado previo o un conflicto consistente, sin duplicar stock, Trade-In, auditoría ni efectos económicos.

La protección vive en backend y persiste más allá de una instancia API. Ventanas de retención y representación exacta se definen en BCM-004/BCM-006.

## 17. Money Architecture

- No se usa floating point binario para importes comerciales.
- Currency es explícita en todo valor económico.
- Toda conversión ARS↔USD conserva Exchange Rate histórica positiva.
- Sale `Confirmed` conserva precio final, costo, moneda, cotización, Trade-In, cantidades y descuentos.
- Equipment usa Specific Historical Cost.
- Accessory Product usa Moving Weighted Average Cost.
- Gross Profit USD es la métrica base V1.
- Un regalo conserva costo y reduce Gross Profit USD.
- Trade-In no se contabiliza dos veces como contraprestación y gasto.
- Redondeos, escala y representación exacta se deciden en BCM-004.

Los tipos de Money y reglas viven en Pricing / Money; ninguna capa los reemplaza por números ambiguos.

## 18. Inventory Architecture

Equipment y Accessory Product son modelos distintos:

- Equipment representa una unidad individual, con estado e identidad propios.
- Accessory Product representa existencias cuantitativas.

Inventory es propietario de disponibilidad, estado, stock, movimientos y costo de inventario. Sales y Reservations solicitan cambios mediante casos de uso publicados; no editan el estado actual directamente.

Todo cambio significativo produce o se relaciona con un Inventory Movement. El estado actual optimiza la consulta, pero nunca reemplaza la historia explicable de ingresos, ventas, reservas, cancelaciones, Trade-In y ajustes.

## 19. File Storage

### 19.1. Evaluación

| Estrategia | Ventajas | Riesgos |
|---|---|---|
| Filesystem local | Simple en una máquina | Dificulta réplicas, backups, recuperación y despliegues efímeros |
| Object storage | Escalable, durable, compatible con acceso firmado | Requiere autorización, lifecycle y manejo de fallos |
| Binarios en PostgreSQL | Transacción y backup unificados | Aumenta tamaño, I/O y costo de la base operacional |

### 19.2. Decisión

Producción utiliza **object storage privado y compatible con el modelo S3**, sin fijar proveedor en esta fase.

- PostgreSQL conserva metadata, ownership, estado y referencia del objeto.
- El archivo binario no se almacena en la base operacional.
- La Web no recibe credenciales permanentes ni acceso público irrestricto.
- La API autoriza uploads/downloads y puede emitir URLs firmadas de corta duración.
- Se validan tamaño, tipo permitido y metadata; análisis adicional podrá incorporarse.
- Backups y lifecycle de archivos se coordinan con la retención de metadata.
- Desarrollo local utiliza una implementación compatible o adapter local, sin cambiar reglas de aplicación.

## 20. Configuration

### 20.1. Application Configuration

Configuración necesaria para ejecutar el sistema: conexión a base, secretos criptográficos, origen permitido, storage, logging y límites operativos.

- Se obtiene de variables de entorno o secret manager del entorno.
- Se valida al iniciar y falla de forma explícita si falta un valor requerido.
- Secretos nunca se incluyen en bundles Web, repositorio o logs.
- La Web solo recibe configuración pública explícitamente permitida.

### 20.2. Business Configuration

Valores administrados por Organization: cotización sugerida, catálogos, condiciones y medios de pago.

- Se persisten como información de negocio.
- Están sujetos a autorización y auditoría.
- No se modelan como variables de entorno.
- Cambios actuales no reescriben historia comercial.

## 21. Validation

La validación se divide en tres capas complementarias:

1. **Request validation:** forma, tipos, límites y campos desconocidos en toda entrada externa.
2. **Domain validation:** estados, transiciones, disponibilidad, Money, reversibilidad y demás invariantes.
3. **Database invariants:** unicidad, relaciones y constraints que protegen ante concurrencia o errores de aplicación.

La Web valida para feedback inmediato, pero la API repite toda validación relevante. Datos de archivos, jobs futuros y proveedores externos también son entradas no confiables.

## 22. Error Handling

La API usa una taxonomía uniforme:

| Categoría | Significado | Tratamiento externo |
|---|---|---|
| Validation | Entrada mal formada o incompleta | Campos y código seguro para corregir |
| Authentication | Identidad ausente o inválida | Respuesta genérica sin filtrar detalles |
| Authorization | Identidad válida sin permiso/contexto | Denegación consistente |
| Not Found | Recurso inexistente o no visible en tenant | Sin revelar recursos de otra Organization |
| Conflict | Estado cambió o recurso ya está ocupado | Código estable y acción sugerida |
| Domain Rule Violation | Invariante impide la operación | Mensaje funcional controlado |
| Infrastructure | Fallo inesperado de base, storage o red | Mensaje genérico, correlation ID y log interno |

Cada error expuesto incluye un código estable, mensaje seguro y correlation/request ID. Puede incluir detalles de campos cuando sea apropiado. Nunca expone stack traces, queries, tokens, secretos ni datos internos sensibles.

## 23. Logging

V1 adopta structured logging en formato procesable por máquinas.

Campos conceptuales mínimos:

- timestamp;
- level;
- service/environment;
- correlation/request ID;
- operación o route template;
- resultado y duración;
- User/Organization referenciados de forma segura cuando corresponde;
- error code y causa interna sanitizada.

Niveles:

- **debug:** diagnóstico detallado, desactivado o limitado en producción;
- **info:** lifecycle y operaciones normales relevantes;
- **warn:** condición inesperada o recuperable;
- **error:** fallo que requiere investigación.

No se loguean passwords, tokens, cookies, secretos, contenido completo de archivos, datos de pago ni información personal innecesaria. La redacción y allowlist de campos se centralizan. No se elige proveedor externo obligatorio en BCM-003.

## 24. Audit vs Technical Logs

| Technical Log | Audit Record |
|---|---|
| Explica salud y ejecución del software | Explica una acción de negocio sensible |
| Puede tener retención operativa corta | Tiene retención y acceso definidos por política |
| Incluye correlation ID, duración y errores | Incluye User, Organization, acción, objeto, fecha y motivo cuando corresponde |
| Puede cambiar de formato por observabilidad | Debe preservar interpretación funcional |

Los logs técnicos no reemplazan Audit Records. Confirmaciones, cancelaciones, ajustes manuales, cambios sensibles y resoluciones autorizadas deben generar auditoría funcional según alcance de BCM-005.

## 25. Observability

V1 requiere:

- captura centralizada de errores no controlados;
- correlation ID entre Web, API, logs y respuestas;
- health check de proceso y readiness separado;
- verificación de conectividad PostgreSQL y storage sin exponer secretos;
- métricas de requests, latencia, errores y saturación;
- visibilidad de conexiones y queries lentas;
- medición de operaciones comerciales lentas y conflictos;
- uptime y alertas básicas;
- trazas básicas en los límites API, database y storage.

No se introduce una plataforma distribuida compleja. La estrategia y proveedores se completan en OBSERVABILITY.md.

## 26. Cache

### 26.1. Decisión

BCM SOFT V1 no incorpora Redis, distributed cache ni cache de aplicación como requisito inicial.

PostgreSQL, queries correctas, índices basados en carga real y cache HTTP/client-side controlada deberían cubrir 10–40 usuarios concurrentes. Agregar cache de datos comerciales antes de medir aumenta riesgo de valores obsoletos e invalidación incorrecta.

Principio: **measure before caching**.

Una cache solo se introduce con:

- evidencia de bottleneck;
- ownership de invalidación;
- tolerancia de staleness documentada;
- métricas de hit/miss;
- estrategia ante indisponibilidad.

Sesiones no justifican Redis inicialmente porque se almacenan en PostgreSQL.

## 27. Background Jobs

V1 no introduce message broker ni worker separado por defecto. Las operaciones críticas de Sale, Reservation, Trade-In, stock y auditoría permanecen síncronas y transaccionales.

Capacidades futuras candidatas:

- emails;
- exportaciones pesadas;
- vencimientos automáticos;
- integraciones externas;
- generación de reportes costosos;
- procesamiento adicional de archivos.

El punto de extensión será un contrato de Job y adapters fuera del Domain. Cuando exista una necesidad real, se elegirá una cola durable y un worker desplegable separadamente. No se simulan garantías de cola mediante tareas en memoria para trabajo crítico.

## 28. Performance Principles

- Server-side pagination con límites máximos.
- Server-side filtering, search y sorting sobre campos permitidos.
- No realizar fetch masivo para filtrar en la Web.
- Seleccionar solo los datos necesarios.
- Detectar y evitar N+1.
- Diseñar índices a partir de queries y planes reales en BCM-004.
- Mantener payloads razonables y comprimir en el límite HTTP cuando corresponda.
- Usar connection pooling y timeouts.
- Medir p50/p95/p99 de operaciones relevantes antes de optimizar.
- Perfilar API y queries lentas con datos representativos.
- Evitar transacciones largas y llamadas externas dentro de ellas.
- Probar listados con volúmenes superiores a los esperados inicialmente.

## 29. Frontend State Architecture

| Categoría | Uso | Regla |
|---|---|---|
| **Server State** | Datos obtenidos de API, cache, carga, error y revalidación | Una herramienta especializada podrá administrarlo; no copiarlo indiscriminadamente a estado global |
| **Local UI State** | Modales, tabs, expansión, filtros temporales | React state cercano al componente por defecto |
| **Form State** | Valores, validación, dirty state y submit | Aislado por formulario; errores backend se mapean de forma uniforme |

No se adopta un global store para todo. Context se reserva para concerns estables de aplicación, como sesión visual, theme o Current Organization seleccionado después de autorización backend.

Las librerías concretas de server state y forms se eligen en BCM-007 mediante necesidad demostrada. La fuente autoritativa continúa siendo la API.

## 30. Frontend Feature Architecture

Organización conceptual:

```text
apps/web/src/
├── app/
├── features/
│   ├── inventory/
│   ├── sales/
│   ├── customers/
│   ├── reservations/
│   └── settings/
├── shared-ui/
└── infrastructure/
```

- `app/`: composición, routing, providers y shell.
- `features/`: UI, hooks y adapters específicos de una capacidad.
- `shared-ui/`: componentes visuales realmente reutilizables y sin negocio.
- `infrastructure/`: cliente API, observabilidad y adapters del navegador.

Una feature no importa internals de otra. Los flujos cruzados se componen en app-level o mediante contratos públicos. Se evitan carpetas globales gigantes como `components/`, `utils/` o `services/` sin ownership.

## 31. Backend Module Architecture

Estructura conceptual para un módulo con complejidad suficiente:

```text
modules/<module>/
├── domain/
├── application/
├── infrastructure/
└── presentation/
```

- **domain:** entidades, value objects, policies e invariantes sin framework.
- **application:** casos de uso, ports, DTOs internos y coordinación transaccional.
- **infrastructure:** Prisma, storage y proveedores externos.
- **presentation:** controllers, request/response mapping y guards HTTP.

No todos los módulos necesitan cuatro carpetas desde el primer día. Un módulo pequeño puede empezar más simple y separar capas cuando su complejidad lo justifique. No se agregan interfaces de una sola implementación salvo que protejan una frontera real o testabilidad relevante.

Principio: **architecture should scale with complexity**.

## 32. Dependency Direction

Dirección preferida:

```text
Presentation → Application → Domain
Infrastructure ──────────────^ (implementa ports)
```

Reglas:

- Domain no depende de NestJS, HTTP, Prisma, storage o proveedores.
- Application depende de Domain y ports, no de controllers.
- Infrastructure implementa ports y puede depender del framework necesario.
- Presentation traduce protocolos y delega casos de uso.
- Un módulo consume la API pública de otro, no sus repositories o entidades persistidas.
- No se obliga a usar ceremonias de Clean Architecture donde no aporten claridad.

## 33. Shared Code

Pueden existir paquetes intencionales para:

- configuración de TypeScript/lint/test;
- componentes de design system sin reglas de negocio;
- contratos de transporte estables y generados/revisados;
- tipos primitivos verdaderamente compartidos que no transfieran autoridad al frontend;
- utilidades observability agnósticas del dominio.

No pertenecen a un `packages/shared` genérico:

- entidades o repositories del backend;
- lógica de autorización;
- reglas de stock, Sale, Reservation o Money;
- acceso a base de datos;
- helpers sin ownership;
- componentes específicos de una feature.

Compartir un tipo no significa compartir la implementación de una regla. El backend sigue siendo autoritativo.

## 34. Deployment Architecture

Topología inicial:

```text
Static Web Hosting / CDN
          |
          v
      Backend API  ─────> Private Object Storage
          |
          v
      PostgreSQL
          |
          v
 Monitoring / Logs / Error Tracking
```

### 34.1. Decisión

Web y API se despliegan separadamente aunque vivan en el mismo monorepo:

- Web es un build estático versionado y cacheable.
- API es un proceso stateless respecto de memoria local; sesiones e idempotencia persisten fuera de la instancia.
- PostgreSQL y object storage son servicios durables.
- Un único release puede coordinar cambios compatibles de Web y API.

Esto permite escalar y revertir Web/API de manera independiente sin adoptar microservicios. Inicialmente una instancia API es suficiente si cumple disponibilidad; una segunda réplica puede agregarse sin cambiar el modelo.

No se fija proveedor cloud en BCM-003.

### 34.2. Staging y production

- entornos y datos separados;
- artefactos promovibles, no reconstruidos de forma diferente por entorno;
- deploy con health/readiness checks;
- rollback de aplicación documentado;
- cambios de base compatibles con rollback y despliegue gradual;
- backups y restauración verificados antes de depender del entorno productivo.

## 35. Environment Strategy

| Entorno | Propósito | Datos y secretos |
|---|---|---|
| **local** | Desarrollo individual | Datos sintéticos; secretos locales no versionados |
| **test** | Tests automatizados aislados | Base efímera o aislada; fixtures deterministas |
| **staging** | Validación integrada y de despliegue | Sin datos productivos salvo proceso aprobado de anonimización |
| **production** | Operación real | Acceso mínimo, secretos administrados y auditoría |

Nunca se comparten secrets ni base productiva con desarrollo. Migrations se validan en test y staging antes de producción. Configuración faltante detiene el arranque en lugar de degradar silenciosamente seguridad.

## 36. Database Connections

- Un pool por proceso API, no una conexión nueva por request.
- Límites del pool alineados con capacidad PostgreSQL y número de réplicas.
- Timeouts de conexión, statement y transacción.
- Backoff limitado ante fallos transitorios; no retries ciegos de operaciones no idempotentes.
- Métricas de conexiones activas, espera y saturación.
- Cierre ordenado en shutdown y despliegue.
- Herramienta de pooling externa solo si la topología lo necesita.

Los valores concretos se definen con el entorno de deployment y BCM-004.

## 37. Scaling Strategy

### Etapa inicial

- una instancia API o pocas;
- un PostgreSQL;
- Web estática;
- object storage;
- sin Redis, broker ni cluster complejo.

### Crecimiento a cientos de usuarios

- réplicas stateless de API detrás de load balancing;
- pool de conexiones dimensionado globalmente;
- tuning de queries e índices con métricas;
- límites, paginación y backpressure;
- worker separado solo si aparecen jobs reales;
- cache selectiva solo con evidencia.

### Crecimiento posterior

- read strategy o réplicas de lectura si reporting lo justifica;
- partición de workloads de jobs;
- extracción de un módulo solo tras demostrar independencia operativa;
- evolución de storage y observabilidad sin cambiar el Domain.

La arquitectura no presupone millones de usuarios. El monolito modular puede escalar horizontalmente porque no depende de estado de proceso para sesiones, idempotencia o archivos.

## 38. Security by Design

- Backend authoritative.
- Least privilege y deny-by-default.
- Tenant isolation obligatorio en cada capa relevante.
- No hay acceso directo Web → PostgreSQL.
- Toda entrada externa se valida.
- Cookies y sesiones se configuran de forma segura.
- CSRF se mitiga en operaciones state-changing.
- Secretos no viven en repositorio, bundles o logs.
- Queries son type-safe o parametrizadas.
- Archivos son privados y autorizados.
- Acciones sensibles generan Audit Records.
- Valores históricos comerciales permanecen confiables.
- Dependencias y supply chain se revisan en CI.
- Errores no filtran internals.
- Backups y restauración son parte de seguridad y continuidad.

BCM-005 define amenazas, políticas y controles concretos.

## 39. Testing Architecture

| Nivel | Objetivo |
|---|---|
| Unit | Value objects, policies y reglas puras |
| Integration | Módulos y adapters reales en límites controlados |
| Database integration | Constraints, transactions, concurrency y tenant scoping contra PostgreSQL |
| API | Contratos HTTP, auth, errores e idempotencia |
| Frontend component | Interacción, accesibilidad y estados visuales |
| End-to-end selectivo | Flujos críticos completos con mínimo conjunto estable |

Prioridades:

- stock nunca negativo;
- venta única de Equipment;
- confirmación/cancelación atómica e idempotente;
- Reservation y Sale concurrentes;
- Trade-In reversible y `Manual Resolution Required`;
- costos históricos y Gross Profit USD;
- tenant isolation;
- autorización deny-by-default;
- archivos privados;
- auditoría de acciones sensibles.

BCM-008 completa estrategia, pirámide, datos y criterios.

## 40. CI/CD Architecture

Pipeline conceptual por cambio:

1. instalación reproducible desde lockfile;
2. lint y reglas de dependencias arquitectónicas;
3. typecheck;
4. tests unit/integration;
5. tests PostgreSQL cuando corresponda;
6. build Web/API;
7. security y dependency checks;
8. validación de migrations sin aplicarlas a producción desde una PR;
9. creación de artefactos inmutables;
10. deploy a staging;
11. smoke/health checks;
12. aprobación y deploy productivo;
13. verificación y rollback si falla.

No se implementa el pipeline en BCM-003.

## 41. Architecture Decision Records

Las decisiones importantes se registran en `docs/adr/` y no se cambian silenciosamente. Un ADR aceptado puede ser reemplazado por otro ADR que documente el motivo y consecuencias.

ADRs iniciales:

- ADR-001 — Modular Monolith;
- ADR-002 — Monorepo;
- ADR-003 — PostgreSQL;
- ADR-004 — Shared Database Multi-Tenancy;
- ADR-005 — REST API;
- ADR-006 — Server-Side Sessions;
- ADR-007 — Prisma ORM.

## 42. Explicit Non-Goals for V1

Salvo necesidad demostrada y ADR nuevo, V1 excluye:

- microservices;
- Kubernetes;
- Kafka;
- RabbitMQ;
- event sourcing;
- CQRS completo;
- distributed transactions;
- Elasticsearch;
- distributed cache;
- Redis obligatorio;
- GraphQL mientras REST sea suficiente;
- database o schema separado por tenant;
- serverless complexity innecesaria;
- service mesh;
- múltiples stores operacionales para el mismo dominio;
- jobs críticos en memoria sin durabilidad.
- Return y Exchange completos, definidos como Future Domain Capabilities fuera de V1.

## Decisiones diferidas a fases posteriores

No bloquean BCM-003 y tienen una fase propietaria:

| Decisión | Fase |
|---|---|
| Tablas, claves, constraints, RLS, isolation levels, locks, Money precision e índices | BCM-004 |
| Roles/permisos exactos, tiempos de sesión, recuperación, CSRF detallado y amenazas | BCM-005 |
| Convenciones internas de backend y librerías auxiliares | BCM-006 |
| Router, forms, server-state, accesibilidad y design implementation | BCM-007 |
| Cobertura, fixtures, ambientes y quality gates | BCM-008 |
| Proveedor de observability y alertas | BCM-009 |
| Proveedor cloud, regiones, sizing, backups y rollback operativo | BCM-010 |
| Proveedor de object storage | BCM-010 |
| Cola/worker futuro | Tarea futura cuando exista workload V1 aprobado |

## 43. Architecture Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| `ARCH-RISK-001` | Tenant data leak | Exposición crítica entre negocios | Contexto backend validado, scoping por defecto, constraints/policies, tests cruzados y deny-by-default |
| `ARCH-RISK-002` | Race conditions | Doble venta/reserva o stock negativo | Transacciones, locks/updates condicionales, constraints e integration tests concurrentes |
| `ARCH-RISK-003` | Stock inconsistency | Operación comercial no confiable | Inventory ownership, movimientos trazables, atomicidad e idempotencia |
| `ARCH-RISK-004` | Destructive Sale edits | Pérdida histórica y económica | Lifecycle inmutable, correcciones explícitas, audit y permisos |
| `ARCH-RISK-005` | Slow queries | Mala UX y saturación | Pagination, profiling, query budgets, índices basados en evidencia y observability |
| `ARCH-RISK-006` | Architecture erosion | Monolito acoplado difícil de cambiar | Module APIs, dependency rules, ADRs, ownership y reviews pequeños |
| `ARCH-RISK-007` | Overengineering | Mayor costo y menor velocidad | Non-goals explícitos, measure first y ADR para infraestructura nueva |
| `ARCH-RISK-008` | Shared code coupling | Frontend/backend y features acoplados | Paquetes intencionales, sin Domain compartido, contracts estables y ownership |
| `ARCH-RISK-009` | Migration failure | Downtime o datos inconsistentes | Review, backups, staging, compatibilidad y rollback/forward-fix documentado |
| `ARCH-RISK-010` | File security | Acceso no autorizado o contenido dañino | Storage privado, autorización API, URLs cortas, validación y lifecycle |
| `ARCH-RISK-011` | Missing audit | Acciones sensibles inexplicables | Audit Records transaccionales para operaciones definidas y tests |
| `ARCH-RISK-012` | Dependency vulnerabilities | Compromiso o interrupción | Lockfile, actualización controlada, scanning, mínimo de dependencias y revisión de advisories |
| `ARCH-RISK-013` | Connection exhaustion | API indisponible bajo réplicas | Pool budget global, timeouts, métricas y límites por entorno |
| `ARCH-RISK-014` | Non-reversible workflow automated | Corrupción por cancelar operaciones dependientes | `Manual Resolution Required`, validación de reversibilidad y auditoría |

## Fuentes técnicas consultadas

- NestJS Modules, Validation, Testing y CSRF documentation.
- React documentation for TypeScript.
- Vite Guide, production build y TypeScript behavior.
- Prisma ORM documentation for transactions and controlled raw queries.
- Drizzle ORM and TypeORM transaction/migration documentation as alternatives.
- PostgreSQL documentation for Row Security Policies.

Estas fuentes validan capacidades de las herramientas; las decisiones se toman por el contexto de BCM SOFT y no por adopción automática de sus defaults.

## 44. Architecture Principles

1. Simplicity before distribution.
2. Modular boundaries before microservices.
3. Database integrity before application assumptions.
4. Backend is authoritative.
5. Security is cross-cutting.
6. Tenant isolation is mandatory.
7. Historical commercial data must remain trustworthy.
8. Measure before optimize.
9. Prefer explicit code over clever abstractions.
10. Architecture exists to support the product, not to impress.
11. Features are developed vertically.
12. Every module should have a clear owner.
13. Changes should be small and reviewable.
14. Do not introduce infrastructure without demonstrated need.
15. Transactions protect business invariants, not convenience.
16. Shared code requires explicit ownership.
17. Production behavior must be observable and diagnosable.
18. Every cross-tenant access attempt is a security concern.
