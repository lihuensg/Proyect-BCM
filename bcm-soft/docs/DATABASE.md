# BCM SOFT — PostgreSQL Database Design

**Estado:** Completed  
**Fase:** BCM-004 — PostgreSQL Database Design  
**Última revisión:** BCM-012A — Customer Business Decisions Reconciliation

Este documento define el modelo relacional, constraints, transacciones, concurrencia, multi-tenancy, índices y ciclo de datos de BCM SOFT. No contiene SQL ejecutable, `schema.prisma`, migrations ni código.

## Resumen de decisiones

| Área | Decisión |
|---|---|
| Identificadores | UUIDv7 en tipo PostgreSQL `uuid`, generado por la aplicación |
| Tiempo | `timestamptz` en UTC; timezone IANA por Organization |
| Dinero contractual | `numeric(19,2)` |
| Cotizaciones y costos unitarios | `numeric(20,8)` |
| Cálculos intermedios | precisión mínima equivalente a `numeric(38,12)` |
| Moneda | código ISO en `text` con CHECK limitado a USD/ARS en V1 |
| Tenant ownership | `organization_id` explícito y FKs compuestas tenant-aware |
| Equipment status | `text` + CHECK no configurable |
| Accessory stock | estado materializado + ledger especializado, actualizados atómicamente |
| Product category | exactamente una FK tenant-aware por producto; no tabla many-to-many |
| Minimum stock | umbral nullable/no negativo; alerta derivada cuando `current_stock <= minimum_stock` |
| Sales lines | tablas separadas para Equipment y Accessory Product |
| Sale correction | documento/versionado y movimientos compensatorios; nunca UPDATE destructivo de snapshots |
| Expenses | documentos económicos tenant-owned, anulables pero no destructivamente editables |
| Warranties | Supplier y Customer separadas; vigencia del proveedor trazable por Equipment |
| Payments | tabla hija; V1 controla cardinalidad en Application |
| Sessions | PostgreSQL, token secreto almacenado solo como hash |
| Security tokens | tablas específicas; secreto aleatorio fuera de DB y SHA-256 determinista por purpose para lookup |
| Authorization invalidation | `authorization_version` por Membership, revalidado por Session |
| Identity abuse limits | ventanas agregadas mínimas y expirables; sin Redis en V1 |
| RLS | adopción parcial desde V1 para tablas comerciales tenant-owned |
| Pagination | keyset para historiales; offset permitido en catálogos pequeños |
| Borrado | RESTRICT e inactivación por defecto; CASCADE solo en hijos efímeros seguros |

## 1. Naming conventions

- Tablas y columnas: `snake_case`, plural para tablas, inglés.
- Primary key: `id`; constraint `pk_<table>`.
- Foreign key: `<referenced_singular>_id`; constraint `fk_<table>__<column>__<referenced_table>`.
- Unique: `uq_<table>__<columns>`.
- Check: `ck_<table>__<rule>`.
- Index: `ix_<table>__<columns>`, agregando sufijo de propósito cuando corresponda.
- Partial unique index: `ux_<table>__<columns>__<predicate>`.
- Timestamps: sufijo `_at`; tipo `timestamptz` salvo una fecha civil explícita.
- Campos normalizados: sufijo `_normalized`.
- No se usan nombres con mayúsculas ni identificadores que requieran quoting.

Ejemplos conceptuales: `organization_memberships`, `organization_id`, `created_at`, `uq_organization_memberships__organization_id_user_id`, `ix_sales__organization_id_confirmed_at`.

## 2. Identifiers

### 2.1. Comparación

| Estrategia | Ventajas | Costos |
|---|---|---|
| UUIDv4 | Nativo, opaco y distribuible | Inserciones aleatorias reducen localidad de índices |
| UUIDv7 | Opaco, distribuible y aproximadamente ordenado por tiempo | Requiere generación compatible y no reemplaza timestamps |
| `bigint identity` | Compacto, rápido y fácil de depurar | Secuencial al exponer, coordinación central y enumeración sencilla |
| CUID/ULID | Distribuibles y legibles como texto | Menor integración nativa; más espacio y validación propia |

### 2.2. Decisión

Todas las entidades principales utilizan **UUIDv7** almacenado como PostgreSQL `uuid`.

- Se genera en la aplicación mediante una implementación estándar y testeada.
- No depende de que producción ejecute una versión de PostgreSQL con función generadora UUIDv7.
- Prisma lo representa mediante el tipo nativo UUID.
- Su orden temporal mejora localidad, pero el orden de negocio siempre usa timestamps o números comerciales.
- No se extrae fecha del ID como fuente autoritativa.
- IDs comerciales legibles son separados del PK.

IDs internos de tablas puramente técnicas de alto volumen podrían evaluarse como `bigint` en el futuro, pero V1 mantiene uniformidad UUIDv7.

## 3. Time

- Todos los instantes se almacenan como `timestamptz` y se interpretan en UTC.
- PostgreSQL normaliza internamente `timestamptz` y la aplicación presenta según `organizations.timezone`.
- `timezone` usa nombre IANA, por ejemplo `America/Argentina/Buenos_Aires`, no un offset fijo.
- `created_at`: momento de persistencia.
- `updated_at`: último cambio del estado actual, actualizado por toda escritura autorizada.
- `effective_at`/`occurred_at`: momento efectivo del negocio cuando difiere del registro.
- `confirmed_at`, `cancelled_at`, `converted_at`, `revoked_at`, `expires_at`: lifecycle explícito.
- Historia comercial conserva tanto fecha efectiva como fecha de registro cuando sea relevante.

## 4. Organization

### `organizations`

| Campo conceptual | Tipo / regla |
|---|---|
| `id` | UUIDv7 PK |
| `name` | `text NOT NULL`, no vacío |
| `status` | `text NOT NULL` + CHECK (`Active`, `Inactive`) |
| `timezone` | `text NOT NULL`, nombre IANA validado por aplicación |
| `created_at` | `timestamptz NOT NULL` |
| `updated_at` | `timestamptz NOT NULL` |

No contiene catálogos ni preferencias arbitrarias. Organization no se elimina físicamente mientras exista historia.

## 5. Multi-Tenant ownership

`organization_id NOT NULL` aparece directamente en toda tabla tenant-owned, incluso cuando podría inferirse por joins, si mejora RLS, indexing o FKs tenant-aware.

Tenant-owned:

- memberships y settings;
- todos los catálogos de negocio;
- Equipment, Accessory Product y movimientos;
- Customers y Suppliers;
- Sales, lines, corrections, payments y Trade-Ins;
- Reservations;
- Expenses y Warranties;
- archivos y relaciones de archivos;
- Audit Records;
- idempotency keys y counters.

Globales:

- `users`;
- credenciales y sesiones de usuario;
- `organizations`.

Cada tabla tenant-owned posee `UNIQUE (organization_id, id)` además del PK global cuando otra tabla necesita una FK compuesta. Toda relación entre entidades tenant-owned referencia ambos valores para impedir asociaciones cruzadas entre Organizations.

No se confía en coincidencia casual de UUIDs ni en scoping del frontend.

## 6. Users

### `users`

| Campo | Tipo / regla |
|---|---|
| `id` | UUIDv7 PK |
| `email` | `text NOT NULL`, valor presentado |
| `email_normalized` | `text NOT NULL UNIQUE`, trim + lowercase/casefold definido |
| `status` | CHECK (`Active`, `Disabled`) |
| `created_at`, `updated_at` | `timestamptz NOT NULL` |

Email es globalmente único por identidad. La normalización ocurre antes de persistir y la unicidad se refuerza en PostgreSQL.

### `user_password_credentials`

Relación 1:1 con User. Conserva `user_id` PK/FK, `password_hash`, `password_changed_at` y timestamps. El hash contiene algoritmo, salt y parámetros en formato auto-descriptivo; nunca se almacena contraseña ni cifrado reversible. Algoritmo y políticas pertenecen a BCM-005.

## 7. Memberships

### `organization_memberships`

- `id` UUIDv7 PK;
- `organization_id` y `user_id` NOT NULL;
- `role` NOT NULL;
- `status` CHECK (`Active`, `Suspended`, `Revoked`);
- `authorization_version bigint NOT NULL DEFAULT 1 CHECK > 0`;
- `activated_at` nullable, `revoked_at` nullable;
- `created_at`, `updated_at`;
- `UNIQUE (organization_id, user_id)`.

Una Membership se desactiva/revoca; no se duplica para cambiar role. Un User puede tener memberships en múltiples Organizations. CHECK mantiene status y timestamps coherentes. Todo cambio de role, status o permissions persistentes futuras incrementa `authorization_version` en la misma transacción y genera Audit Record. Un cambio del mapping role→permission definido en código entra en vigor con el deployment y no requiere un IAM distribuido.

## 8. Roles and permissions

V1 adopta **roles definidos en código + `organization_memberships.role`**.

- Códigos iniciales: `Owner`, `Admin`, `Seller`, `Viewer`.
- CHECK impide magic strings fuera del conjunto.
- Permissions y mapping role→permission pertenecen al backend y BCM-005.
- Roles no son configurables por Organization en V1.
- No se crean tablas dinámicas de IAM hasta existir una necesidad real.

Agregar roles o permissions futuros requiere migration/control de compatibilidad, pero evita un sistema IAM sobrediseñado.

## 9. Sessions

### `sessions`

| Campo | Regla |
|---|---|
| `id` | UUIDv7 PK, identificador interno |
| `token_hash` | hash criptográfico `bytea` o texto codificado, UNIQUE, nunca token plano |
| `user_id` | FK NOT NULL |
| `current_organization_id` | nullable; selección server-side, no autorización |
| `current_membership_authorization_version` | nullable; snapshot de la Membership seleccionada |
| `expires_at` | `timestamptz NOT NULL`, expiración absoluta |
| `revoked_at` | nullable |
| `last_seen_at` | nullable, actualizado con throttling |
| `created_at` | NOT NULL |
| metadata mínima | user-agent resumido/IP tratada según política; nullable y limitada |

Índices:

- unique lookup por `token_hash`;
- `(user_id, revoked_at)` para revocación/listado;
- `expires_at` para cleanup por lotes.

`(current_organization_id, user_id)` referencia conceptualmente la clave candidate `(organization_id, user_id)` de Membership y ambos campos de contexto son NULL juntos cuando no existe selección. La FK demuestra pertenencia, pero no puede probar status Active: cada request tenant-owned carga la Membership, exige Active y compara su `authorization_version`. Un mismatch refresca el contexto autorizado o lo rechaza; nunca conserva permisos stale. Cambiar Organization es una operación backend autorizada que actualiza Organization y version snapshot juntas. El idle timeout se evalúa desde `last_seen_at` (o `created_at`) con configuración de Security; no se duplica un `idle_expires_at` que pueda divergir.

Session ID secreto se genera con alta entropía; solo el hash llega a PostgreSQL. Organization activa no se confía desde sesión sin validar Membership. CHECK exige `expires_at > created_at`, `last_seen_at >= created_at` cuando exista y coherencia entre contexto/version.

## 10. Business Settings

### `organization_settings`

Tabla estructurada 1:1 con Organization. Inicialmente conserva únicamente preferencias aprobadas y timestamps. No se agrega JSONB genérico.

Para la cotización sugerida incluye:

- `exchange_base_currency_code`;
- `exchange_quote_currency_code`;
- `suggested_exchange_rate numeric(20,8)` con CHECK > 0;
- `exchange_rate_updated_at`;
- `exchange_rate_updated_by`.

Base/quote explícitos evitan asumir la dirección pendiente de la cotización. Las operaciones copian su snapshot; cambiar settings no reescribe historia.

Application configuration permanece fuera de PostgreSQL y proviene del entorno/secret manager.

## 11. Catalog architecture

V1 usa tablas tenant-owned dedicadas:

- `catalog_categories`;
- `catalog_brands`;
- `catalog_models` (FK a brand);
- `catalog_capacities`;
- `catalog_colors`;
- `catalog_functional_conditions`;
- `catalog_cosmetic_conditions`;
- `catalog_payment_methods`;
- `catalog_product_types`.

Campos comunes: `id`, `organization_id`, `name`, `name_normalized`, `is_active`, `created_at`, `updated_at`.

- Unique tenant-aware sobre nombre normalizado dentro del scope adecuado; models incluyen brand.
- `is_active=false` impide selección futura sin romper FKs históricas.
- No hay catálogos globales compartidos: futuros templates pueden copiar valores a cada Organization.
- Estados internos de Equipment/Sale/Reservation y currency no son catálogos configurables.
- No se borra un valor utilizado.
- Cada Equipment y Accessory Product referencia exactamente una Category tenant-aware; no se crea relación many-to-many.
- La ubicación persistente de la policy reusable que decide tracking individual/por cantidad e IMEI obligatorio se resuelve en `DB-DEC-007`; no se hardcodea el nombre “iPhone” en lógica dispersa.

## 12. Equipment

### `equipment`

Campos principales:

- `id`, `organization_id`;
- FKs tenant-aware a category, brand, model, capacity, color, functional/cosmetic condition;
- `battery_health smallint` nullable, CHECK 0–100;
- `imei_normalized text` nullable;
- `status text NOT NULL`;
- costo histórico de adquisición: amount, currency, exchange snapshot nullable y `acquisition_cost_usd`;
- `reference_sale_price_amount`, `reference_sale_price_currency`;
- `origin_type`;
- `notes`;
- fecha de compra/recepción y datos mínimos de Supplier Warranty;
- `created_at`, `updated_at`, `archived_at`, `written_off_at` nullable;
- `written_off_reason` (`Theft`, `Loss`) y `written_off_by_user_id` coherentes con status.

Valores descriptivos actuales provienen de catálogos. Los snapshots de venta viven en sale lines.

Las fotografías usan `stored_files` (Organization, object key opaca, MIME validado, bytes, checksum, status y timestamps) y `equipment_files` (Organization, Equipment, File, orden). Los binarios permanecen en object storage. FKs compuestas evitan enlazar archivos de otra Organization; no se guardan URLs públicas permanentes.

## 13. IMEI

- Se normaliza a dígitos canónicos antes de persistir.
- CHECK valida 15 dígitos cuando no es NULL.
- Unique partial index sobre `(organization_id, imei_normalized) WHERE imei_normalized IS NOT NULL`.
- PostgreSQL considera NULLs distintos por defecto, por lo que múltiples equipos sin IMEI son válidos; el índice parcial expresa además la intención.
- La aplicación detecta el conflicto para entregar error funcional, pero PostgreSQL es la barrera definitiva.

## 14. Equipment status

Se usa `text` + CHECK con valores:

- `Available`;
- `Reserved`;
- `Sold`;
- `UnderReview`;
- `WrittenOff`;
- `Archived`.

No se usa PostgreSQL enum porque agregar/transicionar estados mediante migrations es menos flexible y Prisma maneja adecuadamente text. No se usa tabla catálogo porque los estados son invariantes internas no configurables.

El CHECK valida valores; las transiciones válidas se controlan en Domain/Application dentro de transacción.

## 15. Equipment origin

`origin_type` usa text + CHECK inicial (`Manual`, `TradeIn`; `Purchase` y `Return` solo cuando esas capacidades existan).

Trade-In no depende de un string: `trade_ins.received_equipment_id` crea una FK unique hacia Equipment. Esa relación es el origen navegable y autoritativo. Para Manual no existe entidad origen; el Inventory Movement conserva actor, motivo y fecha.

No se agregan origin IDs polimórficos débiles.

## 16. Accessory Product

### `accessory_products`

- `id`, `organization_id`;
- FKs tenant-aware a category y brand;
- `name`, `name_normalized`, `variant`, `sku_normalized` nullable;
- `status` text + CHECK pendiente de valores finales de dominio;
- `reference_price_amount`, `reference_price_currency`;
- `current_stock integer NOT NULL CHECK >= 0`;
- `minimum_stock integer NULL CHECK >= 0`;
- `current_weighted_average_cost_usd numeric(20,8) NOT NULL CHECK >= 0`;
- `notes`, timestamps, `archived_at`.

`current_stock` y promedio se almacenan como estado materializado autoritativo para lecturas y concurrencia eficiente. El ledger especializado conserva la explicación. Ambos cambian en la misma transacción; una inconsistencia es un error crítico, no una eventualidad aceptada.

La condición de bajo stock se deriva en consulta como `minimum_stock IS NOT NULL AND current_stock <= minimum_stock`; no se persiste un booleano duplicado. Notificaciones durables futuras requieren su propio alcance.

SKU recibe índice tenant-aware no único hasta resolver su unicidad funcional (`DB-DEC-002`).

`accessory_product_files` relaciona Product con `stored_files` y conserva orden. Reutiliza el mismo modelo de metadata y ownership sin almacenar binarios en PostgreSQL.

## 17. Inventory Movement

Se eligen tablas especializadas para conservar FKs y evitar polimorfismo débil.

### `equipment_inventory_movements`

- Organization y Equipment;
- `movement_type`;
- `previous_status`, `new_status`;
- FKs nullable tipadas a Sale, Reservation o Trade-In según origen;
- motivo, actor User, `occurred_at`, correlation ID;
- CHECK de que el origen requerido por movement type esté presente.

### `accessory_stock_movements`

- Organization y Accessory Product;
- `movement_type`;
- `quantity_before`, `quantity_delta`, `quantity_after`;
- `average_cost_before_usd`, `average_cost_after_usd`;
- `incoming_unit_cost_usd` cuando corresponde;
- FK nullable tipada a sale accessory line u otra entidad futura;
- motivo, actor User, `occurred_at`, correlation ID.

CHECK asegura `quantity_after = quantity_before + quantity_delta` y valores no negativos. No se borra un movimiento; reversión crea otro movimiento compensatorio.

## 18. Accessory weighted average cost

En un ingreso:

1. se bloquea la fila de Accessory Product;
2. se leen stock y promedio actuales;
3. se calcula con precisión intermedia alta;
4. se actualizan stock y promedio materializados;
5. se inserta movimiento con before/after e incoming unit cost;
6. todo confirma o revierte junto.

En una Sale, `sale_accessory_lines.historical_unit_cost_usd` copia el promedio vigente. Recalcular ingresos posteriores nunca actualiza la line histórica.

## 19. Customers

### `customers`

- `id`, `organization_id`;
- `name`, `name_normalized`;
- email y teléfono normalizados opcionales;
- `status` (`Active`, `Inactive`);
- `notes`, timestamps.

No hay CRM avanzado ni unicidad obligatoria de contacto. Nombre normalizado solo sirve para búsqueda/advertencia y nunca recibe UNIQUE. La creación puede buscar candidatos por nombre/teléfono/email normalizados; un constraint de bloqueo requiere el identificador fuerte que resuelva `DB-DEC-008`. Una Sale normal permite `customer_id NULL`; Reservation y Trade-In no.

Customers con historia se inactivan, no se eliminan.

## 20. Suppliers

### `suppliers`

- `id`, `organization_id`;
- name/normalized name;
- contacto, teléfono, país y observaciones;
- status y timestamps.

Es alcance básico V1. No se crean Purchase, cuentas corrientes ni pagos a proveedor. La FK futura se incorporará mediante migration cuando el dominio de compras sea definido.

## 21. Sales

### `sales`

- `id`, `organization_id`, `customer_id` nullable;
- `status` text + CHECK: `Draft`, `Confirmed`, `Cancelled`;
- `sale_number` nullable hasta la confirmación;
- `currency`, `exchange_rate_to_usd` y snapshots monetarios;
- `created_by_user_id`, `confirmed_by_user_id`, `cancelled_by_user_id`;
- `created_at`, `confirmed_at`, `cancelled_at`, `cancellation_reason`;
- timestamps de mantenimiento.

Un Draft puede editarse. Confirmed es un documento económico inmutable salvo su transición controlada a Cancelled o la aplicación de Sale Corrections relacionadas. La cancelación/corrección no modifica ni elimina los valores originales: agrega documentos, estado efectivo, metadatos y movimientos compensatorios.

## 22. Human-readable sale numbering

`organization_counters` conserva por Organization el siguiente número de Sale. Al confirmar:

1. se bloquea el contador de la Organization;
2. se incrementa dentro de la misma transacción;
3. se asigna `sale_number bigint`;
4. se confirma la Sale.

UNIQUE `(organization_id, sale_number)` evita duplicados. El formato visible, por ejemplo `SALE-00001234`, es presentación y no se almacena como identidad. Los huecos son aceptables si ocurren por operaciones administrativas; el número no se reutiliza.

## 23. Sale lines

Se usan tablas separadas para preservar integridad tipada.

### `sale_equipment_lines`

- `id`, `organization_id`, `sale_id`, `equipment_id`;
- descripción, marca, modelo e IMEI como snapshots;
- precio, descuento y costo histórico en USD;
- total y timestamps.

La cantidad es implícitamente uno. Un Equipment no puede repetirse dentro de la misma Sale. La venta posterior del mismo Equipment se impide por su estado y bloqueo transaccional, no mediante unicidad histórica global que impediría una reventa legítima después de cancelar.

### `sale_accessory_lines`

- `id`, `organization_id`, `sale_id`, `accessory_product_id`;
- descripción y SKU como snapshots;
- `quantity integer CHECK > 0`;
- precio unitario, descuento, costo unitario histórico USD y total;
- timestamps.

El precio final puede ser cero para un accesorio obsequiado, pero quantity, salida de stock y costo histórico siguen presentes y afectan Gross Profit. No se modela una línea polimórfica con columnas alternativas nullable.

## 24. Sale totals and gross profit

La Sale almacena snapshots de:

- subtotal;
- descuento total;
- total económico;
- total monetario recibido;
- valor total de Trade-Ins;
- costo total histórico USD;
- gross profit USD.

Las líneas y Payments conservan las fuentes auditables. En confirmación se recalculan y validan todos los totales dentro de la transacción; luego quedan inmutables. Gross profit puede ser negativo y no recibe CHECK de positividad. La política exacta de redondeo queda en `DB-DEC-005`.

## 25. Payments

### `sale_payments`

- `id`, `organization_id`, `sale_id`;
- `payment_method_id` como FK tenant-aware al catálogo activo al registrar;
- `payment_method_name_snapshot` para historia;
- monto y moneda originales;
- exchange-rate snapshot y monto normalizado USD;
- referencia externa opcional;
- actor, `received_at`, timestamps.

Se elige tabla hija aunque V1 exponga inicialmente un solo pago: evita incrustar detalles en Sale y permite ampliar cardinalidad sin rediseño destructivo. Hasta resolver `DOM-DEC-025` y `DOM-DEC-042`, la aplicación debe limitar el comportamiento habilitado; la base no presupone pagos parciales ni mezcla de medios (`DB-DEC-001`).

## 26. Trade-Ins

### `trade_ins`

- `id`, `organization_id`, `sale_id`, `customer_id`;
- `received_equipment_id` UNIQUE;
- valor, moneda y exchange-rate snapshots;
- valor normalizado USD;
- `received_at`, `reversed_at`, actor y timestamps.

Una Trade-In exige Customer y su Customer debe coincidir con el de la Sale. El Equipment recibido es la representación autoritativa del bien ingresado; no se duplica su ficha dentro de Trade-In. La relación es **Sale 1:N Trade-In** y no existe UNIQUE sobre `sale_id`; cada `received_equipment_id` sí es único. Cada equipo recibido ingresa `Available` conforme a `DOM-DEC-041` y `DB-DEC-004`.

La igualdad tenant/customer y los cambios de estado que atraviesan varias tablas se validan con transacción de aplicación y, cuando el esquema sea implementado, constraint trigger diferible si aporta una garantía que Prisma no pueda expresar.

## 27. Reversibility and traceability

La reversión es compensatoria:

- Sale pasa de Confirmed a Cancelled una sola vez;
- Equipment vendido vuelve al estado permitido mediante un nuevo movement;
- stock de Accessories se repone mediante movements inversos;
- Trade-Ins registran `reversed_at` y su Equipment recibe el movimiento correspondiente;
- Payments originales permanecen; cualquier devolución de fondos futura será otro hecho, no una edición destructiva.

No se rebobina historia ni se elimina una Sale confirmada.

Antes de compensar se verifica que todos los elementos sigan reversibles. Si un Equipment recibido por Trade-In fue vendido, reservado o afectado por una operación posterior, la reversión automática se rechaza y se registra `Manual Resolution Required`; no se altera esa historia posterior. Los movements y referencias de origen permiten determinar esta condición sin inferirla solo del estado actual.

## 27A. Sale Corrections

La persistencia futura separa la Sale original de sus correcciones. Como mínimo, `sale_corrections` es tenant-owned y conserva Sale/version previa, estado, reason, actor, `occurred_at`, `effective_at`, snapshots before/after y una idempotency key. Las líneas/deltas tipados y los Inventory Movements compensatorios se escriben atómicamente; no se ejecuta UPDATE sobre líneas/snapshots confirmados.

La representación exacta de versiones, deltas monetarios/pagos y atribución a períodos se cierra en `DB-DEC-009` antes de la migration. Una dependencia posterior no reversible impide aplicar automáticamente la corrección y conserva el intento como conflicto/`Manual Resolution Required`, sin efectos parciales.

## 27B. Warranty persistence impact

Supplier Warranty y Customer Warranty no comparten una única tabla polimórfica. Equipment conserva al menos fecha de compra/recepción, plazo informado y vencimiento de Supplier Warranty; la vigencia es derivable desde el vencimiento y la fecha de consulta. El vencimiento almacenado debe ser consistente con fecha/plazo al registrar o corregir.

Customer Warranty se relacionará con Sale y línea/equipo cubierto, con snapshots de cobertura/vigencia. Defaults, lifecycle y representación final permanecen en `DB-DEC-010`; no se crean Purchase ni warranty claims por anticipado.

## 27C. Expenses

La entidad futura `expenses` es tenant-owned y conserva categoría, descripción, amount, currency, exchange-rate y normalized USD snapshots, `occurred_at`, actor, status (`Recorded`, `Voided`), reason y timestamps. Un Expense ya incluido en resultados se corrige/anula mediante historia explícita; no se borra ni sobrescribe destructivamente.

Las categorías se modelarán con referencia tenant-aware, no texto libre como única fuente, cuando `DB-DEC-012` cierre la taxonomía y tratamiento interno de inversiones. Dashboard agrega desde Sales/lines/Expenses autoritativos; V1 no introduce materialized analytics, warehouse ni una segunda fuente de verdad.

## 28. Reservations

### `reservations`

- `id`, `organization_id`, `customer_id`, `equipment_id`;
- status: `Active`, `ConvertedToSale`, `Cancelled`;
- `expires_at timestamptz NOT NULL`, elegido por Reservation;
- depósito opcional con amount/currency/exchange-rate snapshots;
- `converted_sale_id` nullable UNIQUE;
- `created_by_user_id`, timestamps de creación, conversión y cancelación;
- motivo/notes.

Customer y Equipment son obligatorios. La activación cambia el Equipment de Available a Reserved en la misma transacción. Convertir crea/confirma la Sale conforme a las reglas de ventas, enlaza exactamente esa Sale y cambia Equipment a Sold. Cancelar devuelve el Equipment al estado permitido. No existe Reservation sin Equipment en V1.

Al alcanzar `expires_at`, una consulta/alerta identifica la Reservation vencida sin cambiar automáticamente status, Equipment ni saldos. La acción posterior y la evidencia de devolución quedan bloqueadas por `DOM-DEC-058`.

## 29. Single active reservation per Equipment

Un índice único parcial impone:

```sql
UNIQUE (organization_id, equipment_id) WHERE status = 'Active'
```

PostgreSQL permite varios registros históricos no activos, pero nunca dos activos para el mismo Equipment. La operación además bloquea el Equipment y verifica su estado, porque el índice por sí solo no sincroniza el agregado Equipment.

## 30. Reservation → Sale

`reservations.converted_sale_id` es nullable y UNIQUE. Solo se completa en la misma transacción que cambia status de Active a ConvertedToSale y crea/confirma la Sale. CHECK mantiene coherentes `status`, `converted_sale_id` y `converted_at`: una reserva no convertida no tiene Sale; una convertida exige ambas referencias. La navegación inversa se obtiene por esa misma FK, sin una segunda columna que pueda divergir. La conversión exige que Sale, Reservation, Equipment y Customer pertenezcan a la misma Organization y que el Customer sea el de la reserva.

## 31. Deposit / Seña

Los campos nullable son `deposit_amount`, `deposit_currency`, `deposit_exchange_rate_to_usd` y `deposit_amount_usd`. CHECK exige que sean todos NULL o formen un conjunto válido; amount no puede ser negativo y exchange rate debe ser positivo cuando aplica. NULL significa sin depósito; cero es un importe registrado de cero y no se usa como sustituto de ausencia.

El depósito es un snapshot reembolsable vinculado a la Reservation. Su tratamiento como Payment al convertir y el registro/ejecución de la devolución no se presuponen antes de cerrar `DOM-DEC-058` y las reglas de Payments.

## 32. Money representation

- importes contractuales: `numeric(19,2)`;
- precios unitarios, exchange rates, costos unitarios y valores normalizados que requieren mayor escala: `numeric(20,8)`;
- cálculos intermedios: `numeric(38,12)` o expresión equivalente antes del redondeo final;
- cantidades de stock discretas: `integer`.

No se usa `real`, `double precision` ni tipos binarios para dinero. La base controla rango, signo y escala de persistencia; el modo y momento exactos de redondeo quedan como decisión explícita pendiente.

## 33. Currency representation

V1 usa `text` con CHECK `IN ('USD', 'ARS')`, no PostgreSQL ENUM. Es un conjunto pequeño y estable para V1, pero una migration puede ampliar el CHECK sin las restricciones operativas de un ENUM. No se crea tabla Currency porque no hay metadatos monetarios administrables.

Los campos monetarios se nombran con sufijo `_amount`; toda moneda acompaña al importe o está definida inequívocamente por el documento. Exchange rate significa unidades de la moneda de origen por USD o la convención inversa que defina Product; la convención definitiva debe documentarse junto con `DB-DEC-005` antes de implementar.

## 34. Historical snapshots

Los snapshots se toman al confirmar la Sale o registrar el hecho irreversible:

- exchange rate;
- precios y descuentos;
- descripción, marca, modelo, SKU e IMEI mostrados en el comprobante;
- weighted average cost de Accessories;
- costo del Equipment;
- valores de Payments y Trade-Ins.

Cambios posteriores en catálogos, Customer, Equipment, precios sugeridos o configuración no alteran documentos confirmados. Los snapshots no sustituyen FKs cuando la entidad fuente debe seguir trazable; ambos se conservan.

## 35. Audit Records

### `audit_records`

- `id`, `organization_id` cuando corresponda;
- `actor_user_id` nullable para procesos del sistema;
- action, entity type, entity UUID;
- before/after JSONB sanitizados;
- reason, correlation ID, IP/user-agent cuando la política de seguridad lo permita;
- `occurred_at`.

Es append-only mediante privilegios del rol runtime y controles de implementación. JSONB se limita a cambios auditables, con allowlist y redacción de secretos/tokens/credenciales. Audit Record complementa, pero no reemplaza, movements, estados ni documentos económicos especializados.

## 36. Soft deletion

- Organization, Users, Memberships, catálogos, Customers, Suppliers y Products se desactivan o archivan cuando tienen referencias;
- Equipment real se archiva o pasa a `WrittenOff` conforme a lifecycle;
- Sales confirmadas/canceladas, Payments, Trade-Ins, movements y Audit Records nunca se eliminan por flujo normal;
- Drafts sin efectos, sesiones expiradas e idempotency keys vencidas pueden purgarse con jobs controlados y ventanas documentadas;
- no se agrega `deleted_at` indiscriminadamente.

Physical delete de Equipment solo se permite para una carga errónea/prueba sin Sale confirmada, Reservation, Trade-In, Warranty ni movement/dependencia histórica crítica. La operación valida FKs con RESTRICT, conserva un Audit Record sin FK destructiva al objeto eliminado y retira atómicamente solo hijos efímeros de creación. Robo/pérdida usa `WrittenOff` y un movement; nunca DELETE.

Los índices y consultas deben distinguir estado activo de historia sin ocultar accidentalmente registros requeridos para auditoría.

## 37. Idempotency

### `idempotency_keys`

- `id`, `organization_id`, `operation`, `key`;
- hash del request canónico;
- status `InProgress`, `Completed`, `FailedRetryable`;
- tipo/ID de resultado y respuesta segura mínima;
- `created_at`, `completed_at`, `expires_at`.

UNIQUE `(organization_id, operation, key)`. La reserva de la key y el cambio de negocio ocurren en una estrategia transaccional que impida dos ejecuciones. Reutilizar una key con request hash diferente es conflicto. Las operaciones críticas —confirmar/cancelar Sale, crear/convertir/cancelar Reservation e ingresar stock— requieren key persistente; no basta memoria de proceso.

## 38. Concurrency — Equipment sale

La transacción bloquea la fila Equipment (`SELECT ... FOR UPDATE` mediante SQL encapsulado cuando Prisma no lo exprese), valida Organization/status Available, crea la línea, cambia a Sold e inserta movement. Un competidor espera y, al recuperar el lock, falla por estado. No existe lectura y actualización separadas fuera de transaction.

## 39. Concurrency — Accessory stock

Se bloquea Accessory Product o se usa UPDATE condicional equivalente; se valida `current_stock + delta >= 0`, se actualizan stock/WAC y se inserta movement en una transacción. CHECK `current_stock >= 0` actúa como última barrera. Nunca se hace read-modify-write fuera de ella.

## 40. Concurrency — Reservations

La transacción bloquea la fila Equipment (`SELECT ... FOR UPDATE` mediante SQL encapsulado cuando Prisma no lo exprese), valida organization/status, realiza el cambio e inserta movement. La unicidad parcial agrega una segunda barrera para Reservation.

Crear, vender o convertir toman el mismo lock de Equipment. La conversión bloquea además Reservation y verifica Active y el mismo Customer; una Sale directa no puede consumir un Equipment Reserved. De este modo la unicidad evita doble reserva y el lock/status evita reserva contra venta simultánea.

## 41. Cancellation idempotency

Confirmación y cancelación bloquean Sale y entidades afectadas en orden determinista. Status + idempotency key hacen la transición one-way; un segundo intento devuelve el resultado previo o conflicto, nunca duplica movimientos. Los deadlocks se reintentan con límite y jitter en la capa de aplicación.

Cada restitución referencia la Sale/line original y tiene identidad única por tipo de compensación. `cancelled_at`, status terminal, `trade_ins.reversed_at` y los movements compensatorios se escriben juntos; no puede ejecutarse dos veces la restitución de Equipment, incremento de Accessories o reversión de Trade-In.

## 42. Row-Level Security

Se adopta RLS parcialmente desde V1 para tablas operativas tenant-owned, como segunda barrera además de filtros y FKs tenant-aware.

- el rol runtime no es owner ni tiene `BYPASSRLS`;
- cada operación tenant-owned corre dentro de una transacción que fija contexto de Organization con alcance local a esa transacción;
- ausencia de contexto produce denegación, no acceso global;
- migrations/admin usan un rol separado y auditado;
- `users` y credenciales/sesiones globales no reciben política tenant directa;
- `organizations` y `organization_memberships` quedan fuera de la policy operativa inicial: bootstrap/switching usa repositories estrictos y capacidades de plataforma separadas;
- tablas internas globales de recovery y rate limiting no reciben RLS tenant;
- Organization Invitations documenta una excepción V1 porque la aceptación pre-auth necesita lookup por token sin Current Organization.

La primera migration que cree cada tabla de negocio debe habilitar/forzar RLS y su policy, o registrar explícitamente por qué está excluida. El uso con pool exige contexto transaction-local y tests de aislamiento; nunca una variable de sesión persistente que pueda filtrarse a otra solicitud.

## 43. Index strategy

Se crean índices por consultas demostradas, con Organization como prefijo cuando el acceso sea tenant-scoped:

| Área | Índices iniciales |
| --- | --- |
| Equipment | `(organization_id, status, created_at, id)`, IMEI único parcial, filtros por brand/model/category, vencimiento de Supplier Warranty |
| Accessories | `(organization_id, status, name_normalized)`, `(organization_id, sku_normalized)` no único inicialmente |
| Sales | UNIQUE number, `(organization_id, confirmed_at DESC, id DESC)`, `(organization_id, status, created_at DESC, id DESC)`, customer + date |
| Reservations | UNIQUE parcial activo por Equipment, status + created date, customer + created date |
| Customers | name normalizado; email/teléfono normalizados cuando sean filtros reales |
| Accessory Product | `(organization_id, current_stock)` y filtro parcial/candidato para `current_stock <= minimum_stock` si evidencia de plan lo justifica |
| Expenses | `(organization_id, occurred_at, id)`, status y category + occurred date |
| Sale Corrections | `(organization_id, sale_id, occurred_at, id)` y unicidad de versión/idempotencia definida |
| Sessions | token hash UNIQUE; user + revocation/expiry; expiry para limpieza |
| Recovery tokens | token hash UNIQUE; user + created date para revocación; expiry para cleanup |
| Invitations | token hash UNIQUE; Organization + email + lifecycle; expiry para cleanup |
| Identity rate limits | UNIQUE operation + dimension + fingerprint + window; expiry para cleanup |
| Movements | Organization + product/equipment + occurred date + id; Organization + occurred date + id |
| Audit | Organization + occurred date + id; Organization + entity type + entity ID |
| Idempotency | UNIQUE scope/key; expiry para limpieza |

FKs usadas en joins reciben índice explícito cuando no estén cubiertas. No se duplican índices equivalentes ni se antepone Organization a una búsqueda global altamente selectiva como session token hash.

## 44. Composite index tenant prefix

Los índices tenant-scoped comienzan normalmente por `organization_id` porque todas sus queries lo filtran y ello reduce el rango inspeccionado. No es regla ciega: una UNIQUE global de session token hash, una limpieza global por expiry o un índice cuya primera columna deba soportar una tarea operacional cross-tenant pueden usar otro orden. El orden posterior sigue igualdad, rango y ordenamiento de la query real; se valida con `EXPLAIN` y volumen representativo.

## 45. Search

- exacta por IMEI normalizado, sale number y SKU;
- prefijo/igualdad por columnas normalizadas de nombres, email y teléfono;
- `ILIKE` acotado para catálogos pequeños;
- `pg_trgm` y GIN solamente si mediciones reales justifican búsqueda tolerante;
- sin Elasticsearch ni motor externo en V1.

La normalización se define una vez en aplicación y se protege con constraints razonables. Los datos de presentación originales se conservan separados.

## 46. Pagination

Se usa keyset pagination para colecciones grandes o append-only:

- Sales por `(confirmed_at DESC, id DESC)` o `(created_at DESC, id DESC)`;
- movements y Audit Records por `(occurred_at DESC, id DESC)`;
- Equipment por `(created_at DESC, id DESC)` cuando crezca el inventario.

El cursor incluye todos los componentes y el filtro Organization; `id` desempata de forma estable. Offset/limit queda reservado para catálogos y pantallas administrativas pequeñas donde saltar a una página sea necesario. No se pagina por una columna mutable sin desempate.

## 47. Referential actions

La regla por defecto es `ON DELETE RESTRICT` / `NO ACTION` para Organizations, entidades de negocio e historia.

- `CASCADE` solo para hijos puramente internos cuya raíz puede eliminarse con seguridad, por ejemplo credencial/sesiones al eliminar excepcionalmente una identidad sin historia o líneas de un Draft descartable;
- `SET NULL` solo para actor opcional cuando la retención del hecho es superior a la identidad, aunque el flujo normal desactiva Users;
- Sales confirmadas, Payments, Trade-Ins, movimientos y Audit Records nunca dependen de cascadas destructivas;
- las FKs tenant-aware referencian `(organization_id, id)` para impedir enlaces cruzados.

Para datos de seguridad: Recovery Tokens y Sessions se revocan al desactivar User y se purgan por lifecycle, no por una cascade cotidiana; Invitations usan RESTRICT hacia Organization y Users relacionados, y se revocan al desactivar Organization; Identity Rate Limit Windows no conserva FK a User/Organization para evitar PII y acoplamiento. El borrado físico excepcional de una identidad solo puede incluir hijos efímeros cuando no exista historia que exija RESTRICT.

Toda excepción se documenta en la migration que la introduce.

## 48. Database constraints catalog

| ID | Entity | Invariant | PostgreSQL enforcement | Application enforcement |
| --- | --- | --- | --- | --- |
| DB-INV-001 | User | email normalizado globalmente único | UNIQUE | normalizar y validar formato |
| DB-INV-002 | Membership | una fila por Organization/User | UNIQUE compuesto | impedir duplicado y validar rol |
| DB-INV-003 | Membership/Sale/etc. | roles y status admitidos | CHECK | state machine por comando |
| DB-INV-004 | Session | token hash irrepetible | UNIQUE | generar secreto fuerte; almacenar solo hash |
| DB-INV-005 | Session | expiry posterior a creación | CHECK | calcular TTL y revocación |
| DB-INV-006 | Equipment | IMEI no nulo: 15 dígitos y único por Organization | CHECK + UNIQUE parcial | normalizar antes de persistir |
| DB-INV-007 | Tenant-owned entities | ninguna FK atraviesa Organizations | FK compuesta | repository siempre tenant-scoped |
| DB-INV-008 | Accessory Product | stock materializado nunca negativo | CHECK | lock/UPDATE condicional transaccional |
| DB-INV-009 | Inventory | WAC y costos no negativos | CHECK | cálculo decimal validado |
| DB-INV-010 | Accessory Movement | before + delta = after | CHECK | construir movement con el update |
| DB-INV-011 | Reservation | una activa por Equipment | UNIQUE parcial | lock de Equipment y status check |
| DB-INV-012 | Reservation | Customer y Equipment obligatorios | NOT NULL + FK | validar mismo tenant/estado |
| DB-INV-013 | Reservation | conversión a lo sumo una Sale | UNIQUE + CHECK de estado/timestamps | comando idempotente |
| DB-INV-014 | Sale | sale number único por Organization al confirmar | UNIQUE compuesto/parcial | contador bloqueado en transaction |
| DB-INV-015 | Sale | status, número y timestamps coherentes | CHECK | state machine |
| DB-INV-016 | Sale | cancelación con actor/motivo/timestamp coherentes | CHECK | autorización y comando idempotente |
| DB-INV-017 | Sale Accessory Line | quantity positiva | CHECK | validar disponibilidad |
| DB-INV-018 | Sale Equipment Line | Equipment no repetido dentro de Sale | UNIQUE compuesto | detectar duplicado antes de confirmar |
| DB-INV-019 | Monetary entities | currency es USD o ARS | CHECK | value object Currency |
| DB-INV-020 | Monetary entities | exchange rate requerido positivo | CHECK | convención y redondeo centralizados |
| DB-INV-021 | Reservation | depósito ausente o conjunto completo coherente | CHECK | validar captura del depósito |
| DB-INV-022 | Trade-In | received Equipment pertenece a una Trade-In | UNIQUE | validar lifecycle |
| DB-INV-023 | Trade-In | comparte Organization y Customer con Sale | FK compuesta + constraint trigger si procede | transaction de dominio |
| DB-INV-024 | Idempotency Key | key única por tenant/operación | UNIQUE compuesto | comparar request hash y replay seguro |
| DB-INV-025 | Audit/Movements | append-only | privilegios; trigger selectivo si procede | sin comandos update/delete |
| DB-INV-026 | Inventory | cambio y movement confirman juntos | transaction | servicio de aplicación obligatorio |
| DB-INV-027 | Recovery Token | token hash único en su tabla y token nunca persistido | UNIQUE + NOT NULL | CSPRNG y hash por purpose |
| DB-INV-028 | Recovery Token | expiry posterior a creation; usado/revocado no reutilizable | CHECK + UPDATE condicional | reset/revocación atómicos |
| DB-INV-029 | Invitation | token hash único en su tabla | UNIQUE + NOT NULL | CSPRNG y hash por purpose |
| DB-INV-030 | Invitation | una invitación pendiente por Organization/email | UNIQUE parcial | revocar anterior antes de re-invitar |
| DB-INV-031 | Invitation | accepted/revoked/expired no se acepta nuevamente | CHECK + UPDATE condicional | acceptance transaction e idempotency |
| DB-INV-032 | Invitation/Membership | aceptar no duplica Membership | UNIQUE Membership | crear/activar en la misma transaction |
| DB-INV-033 | Membership | authorization version positiva y crece con cambios de acceso | CHECK | update atómico + audit |
| DB-INV-034 | Session | Current Organization pertenece al mismo User | FK compuesta a Membership | exigir Active y comparar version por request |
| DB-INV-035 | Session | Organization context y version son ambos NULL o ambos presentes | CHECK | switch autorizado y atómico |
| DB-INV-036 | Identity Rate Limit Window | una ventana agregada por operation/dimension/fingerprint | UNIQUE compuesto | incremento atómico y límites configurados |
| DB-INV-037 | Security temporary data | creation/expiry/lifecycle timestamps coherentes | CHECK | rechazo de expired/used/revoked y cleanup |
| DB-INV-038 | Product | exactamente una Category del mismo tenant | FK tenant-aware NOT NULL | validar categoría activa al crear |
| DB-INV-039 | Accessory Product | minimum stock ausente o >= 0 | CHECK | alerta derivada en query |
| DB-INV-040 | Equipment | `WrittenOff` exige cause/actor/time coherentes | CHECK + FK | comando y movement atómicos |
| DB-INV-041 | Sale Correction | original inmutable y corrección versionada/idempotente | FKs + UNIQUE/CHECK por diseño final | use case transaccional |
| DB-INV-042 | Expense | amount válido; void metadata coherente | CHECK + FK tenant-aware | corrección/void explícito |
| DB-INV-043 | Reservation | `expires_at` posterior a creación | CHECK | clock/alert sin efecto automático |

Los mecanismos marcados como transacción no se degradan a validaciones UI. Si una garantía cross-row puede expresarse de forma segura en PostgreSQL, se preferirá constraint/constraint trigger; triggers generales con efectos ocultos se evitan.

## 49. Transaction catalog

| Operation | Isolation/Locking considerations | Affected entities | Failure behavior |
| --- | --- | --- | --- |
| Confirm Sale | transaction; lock Sale/counter y productos en orden estable | Sale, lines, counter, Equipment, Accessories, Payments, movements | rollback total; conflicto/idempotent replay |
| Cancel Sale | lock Sale y agregados originales; compensaciones únicas | Sale, Equipment, Accessories, Trade-Ins, movements | rollback total; no doble restitución |
| Sale with Trade-In | locks de confirmación + received Equipment | Sale, Customer, Trade-In, Equipment, movements | rollback total si tenant/customer/origin falla |
| Reserve Equipment | lock Equipment + UNIQUE parcial | Reservation, Equipment, movement | una transacción gana; la otra conflicto |
| Cancel Reservation | lock Reservation y Equipment | Reservation, Equipment, movement | rollback total; replay devuelve estado terminal |
| Convert Reservation to Sale | lock Reservation/Equipment/counter/productos | Reservation, Sale, lines, inventory, movements | rollback total; nunca segunda Sale |
| Accessory intake | lock Accessory; cálculo WAC en transaction | Accessory Product, stock movement | rollback stock y ledger juntos |
| Manual stock adjustment | lock Accessory; CHECK no negativo | Accessory Product, stock movement, Audit Record | rechazo sin cambio parcial |

Todas las operaciones se ejecutan con isolation level y reintentos definidos en implementación. El orden de locks debe ser estable por tipo e ID para reducir deadlocks. No se hacen llamadas de red dentro de la transacción de base.

## 50. Prisma boundaries

Prisma administrará el modelo común, relaciones, queries tipadas y migrations versionadas. SQL explícito en migrations es obligatorio para capacidades que Prisma no representa fielmente:

- índices únicos parciales;
- RLS y policies;
- CHECKs avanzados y constraint triggers diferibles;
- extensiones e índices especializados;
- funciones/privilegios de append-only si se adoptan.

SQL raw en runtime se encapsula en adapters de infraestructura para locks, contexto RLS transaction-local u operaciones atómicas no expresables. Siempre parametrizado, testeado y sin interpolación de input. Prisma no es la fuente única de verdad si omite una garantía presente en PostgreSQL; la migration SQL y este documento también forman el contrato.

Prisma Client existe solo en infraestructura backend: nunca se expone al frontend ni se usa directamente desde controllers. Cada módulo encapsula sus repositories; las transacciones cross-module se coordinan explícitamente desde application services. Toda query selecciona solo campos/relaciones necesarios, pagina colecciones y se revisa por N+1.

## 51. Migration policy

- migrations forward-only, pequeñas, revisables y versionadas;
- ninguna edición retroactiva de una migration aplicada;
- separar cambios de estructura, backfill y enforcement cuando una tabla con datos lo requiera;
- patrón expand/migrate/contract para cambios incompatibles;
- crear índices concurrentemente cuando volumen/operación lo exijan y la herramienta lo permita fuera de transaction;
- validar constraints sobre datos existentes antes de hacerlos obligatorios;
- probar desde una base vacía y desde snapshot representativo;
- aplicar primero en staging y verificar observabilidad/compatibilidad antes de production;
- realizar backup verificado antes de migrations riesgosas;
- rollback operativo preferido mediante nueva migration correctiva, no borrado de historia.

Cada migration declara impacto de locks, duración esperada, compatibilidad entre versiones y procedimiento de reversión/forward-fix.

## 52. Seed strategy

Seeds V1 son mínimos, deterministas e idempotentes:

- no contienen datos personales ni secretos;
- no crean ventas, stock o historia ficticia en producción;
- roles code-defined no necesitan filas;
- una Organization/User inicial solo se crea mediante bootstrap explícito y credenciales inyectadas de forma segura, nunca hardcodeadas;
- datos demo se mantienen separados y solo para entornos locales/test.

No se inventan catálogos comerciales universales: cada Organization los configura.

## 53. Backup considerations

La base PostgreSQL es un conjunto consistente: backup de tablas sin coordinación no es suficiente. La estrategia de Deployment debe definir snapshots/backups automáticos, retención, cifrado, acceso y point-in-time recovery según RPO/RTO futuros.

Los objetos binarios no viven en PostgreSQL; sus keys y metadata sí. Restore debe coordinar base y object storage para no dejar referencias rotas. Se requieren pruebas periódicas de restore en entorno aislado, verificación de RLS/roles/extensions, conteos e invariantes críticas. Un backup no probado no se considera recuperable.

## 54. Initial ER model

```text
User 1---* Session
User 1---* PasswordRecoveryToken
User 1---* OrganizationMembership *---1 Organization
Session 0..1---1 Current OrganizationMembership
Organization 1---1 OrganizationSettings
Organization 1---1 OrganizationCounter
Organization 1---* OrganizationInvitation

Organization 1---* Customer
Organization 1---* Supplier
Organization 1---* Brand / EquipmentModel / Category / EquipmentCondition
Organization 1---* Equipment 1---* EquipmentInventoryMovement
Organization 1---* AccessoryProduct 1---* AccessoryStockMovement
Organization 1---* Expense

Customer 0..1---* Sale 1---* SaleEquipmentLine *---1 Equipment
                         1---* SaleAccessoryLine *---1 AccessoryProduct
                         1---* SalePayment
                         1---* TradeIn 1---1 received Equipment
                         1---* SaleCorrection

Customer 1---* Reservation *---1 Equipment
Reservation 0..1---1 converted Sale
Organization 1---* AuditRecord / IdempotencyKey
IdentityRateLimitWindow (security-internal global, sin FK de PII)
```

Todas las relaciones tenant-owned incluyen Organization en sus FKs aunque el mapa la omita visualmente en algunos enlaces.

## 55. Data lifecycle

| Entity | Creation / update | Archive/deactivate | Retention / deletion |
| --- | --- | --- | --- |
| User | identidad global; email/status actualizables con auditoría | Disabled revoca acceso/sesiones | no borrar si es actor o tiene Membership/history |
| Membership | alta por Organization y cambio de role/status autorizado | Inactive conserva pertenencia histórica | RESTRICT mientras tenga referencias relevantes |
| Customer | datos operativos editables | Inactive cuando tiene historia | no borrar con Sales/Reservations/Trade-Ins |
| Supplier | datos básicos editables | Inactive | no borrar al existir referencias presentes/futuras |
| Equipment | alta manual/Trade-In; cambios mediante lifecycle | Archived o WrittenOff según causa | physical delete solo carga errónea sin historia; nunca con movements/Sales/Reservations/Trade-Ins/Warranty |
| Sale | Draft editable; Confirmed inmutable | Cancelled por compensación, no archive | retención comercial; Draft descartable si no tuvo efectos |
| Sale Correction | documento versionado, append/confirm | lifecycle pendiente en DB-DEC-009 | retención junto a Sale; no delete normal |
| Reservation | Active; solo transiciones de estado | ConvertedToSale o Cancelled terminal | historia retenida; no delete normal |
| Expense | Recorded mediante comando | Voided con reason/actor/time | retención económica; no delete normal tras contabilizar |
| Inventory Movement | creado junto al cambio de inventario | no aplica | append-only, retención histórica |
| Audit Record | creado por evento auditable | no aplica | append-only conforme a política de retención/privacidad |
| Session | login y switching autorizado; last seen throttled | revoked/expired terminal | cleanup temporal por lotes |
| Recovery Token | solicitud pre-auth; solo digest | used/revoked/expired terminal | cleanup tras retención de seguridad configurable |
| Organization Invitation | comando tenant autorizado | accepted/revoked/expired terminal | retención corta y cleanup sin borrar Membership |
| Identity Rate Limit Window | upsert atómico por ventana | expired terminal | cleanup oportunista/scheduled por lotes |

### Equipment

```text
Trade-In/alta -> Available -> Reserved -> Sold
                     |   \        |         |
                     v    \       v         v
                UnderReview  WrittenOff   Available (cancelación autorizada)
                     |          (robo/pérdida)
                     v
                  Archived
```

Cada flecha aceptada produce movement. Equipment recibido por Trade-In inicia `Available`; `WrittenOff` conserva causa, actor y fecha.

### Sale

```text
Draft -> Confirmed -> Cancelled
```

No hay regreso a Draft ni edición económica destructiva post-confirmación. Sale Correction agrega una versión/documento relacionado sin reescribir la original.

### Reservation

```text
Active -> ConvertedToSale
   |
   +----> Cancelled
```

Ambas transiciones terminales son idempotentes y sincronizan Equipment.

## 56. Growth expectations

Inicio esperado: una Organization real, decenas de Users y miles o decenas de miles de filas. El mismo modelo soporta múltiples Organizations, cientos de Users y cientos de miles o millones de movements históricos sin cambiar ownership ni claves.

No se particiona inicialmente. UUIDv7 mejora localidad temporal frente a UUID aleatorio, y los índices tenant/date cubren el acceso esperado. Se medirá tamaño, bloat, latencia y frecuencia de vacuum. No se optimiza para billones de filas.

Candidatos futuros, si la evidencia lo justifica, son `audit_records`, movements e idempotency history por rango temporal. Antes de particionar se debe verificar impacto en PK/UNIQUE, FKs, RLS, Prisma, retención y restores. No se shardea por Organization en V1; el diseño tenant-aware permite evaluar esa evolución sin prometerla.

## 57. Database anti-patterns

- float/double para dinero;
- almacenar dinero sin moneda o exchange snapshot;
- un `organization_id` implícito solo en ancestors;
- IDs secuenciales globales expuestos como protección de acceso;
- IMEI con string vacío para representar ausencia;
- tabla polimórfica de líneas o movimientos sin FKs reales;
- JSONB como reemplazo de columnas y constraints del dominio;
- borrar o editar hechos confirmados para “revertirlos”;
- calcular stock/WAC desde dos fuentes autoritativas divergentes;
- read-modify-write sin lock/UPDATE condicional;
- sesiones o idempotencia solo en memoria;
- confiar en RLS sin filtros tenant-aware, o viceversa;
- contexto RLS persistente en una conexión pooled;
- cascadas destructivas sobre historia;
- offsets profundos para ledgers;
- triggers con efectos de negocio ocultos;
- particionamiento, search engine o catálogos genéricos prematuros.

## BCM-005A — Security persistence addendum

Este addendum incorpora exclusivamente persistencia requerida por `SECURITY.md`. No modifica el modelo económico ni crea un IAM o rate-limiting platform genéricos.

### Password recovery tokens

#### `password_recovery_tokens`

| Campo | Regla conceptual |
| --- | --- |
| `id` | UUIDv7 PK |
| `user_id` | FK global a User, NOT NULL |
| `token_hash` | `bytea NOT NULL UNIQUE`; nunca token raw |
| `created_at` | `timestamptz NOT NULL` |
| `expires_at` | `timestamptz NOT NULL`, posterior a creation |
| `used_at` | nullable, terminal |
| `revoked_at` | nullable, terminal |

CHECK impide que `used_at` y `revoked_at` representen dos finales incompatibles y exige timestamps no anteriores a creation. No se persiste status derivable. El consumo bloquea/actualiza condicionalmente una fila vigente (`used_at/revoked_at IS NULL` y no expirada); dentro de la misma transaction cambia el credential hash, marca el token usado y revoca otros recovery tokens y Sessions del User. Dos consumos concurrentes no pueden ganar.

Índices: UNIQUE `token_hash` para lookup; `(user_id, created_at DESC)` para revocar/listar internamente pendientes; `expires_at` para cleanup. User Disabled invalida sus tokens desde Application aunque la fila permanezca hasta cleanup/retención de seguridad.

### Organization invitations

#### `organization_invitations`

| Campo | Regla conceptual |
| --- | --- |
| `id`, `organization_id` | UUIDv7 y tenant ownership explícito |
| `intended_email`, `intended_email_normalized` | email de destino; normalized NOT NULL |
| `intended_role` | CHECK de roles V1 |
| `token_hash` | `bytea NOT NULL UNIQUE`; nunca token raw |
| `invited_by_user_id` | FK NOT NULL a User |
| `accepted_by_user_id` | FK nullable a User |
| `created_at`, `updated_at`, `expires_at` | `timestamptz`; expiry obligatoria |
| `accepted_at`, `revoked_at` | lifecycle terminal nullable |

CHECK exige timestamps coherentes y evita accepted + revoked. Un UNIQUE parcial sobre `(organization_id, intended_email_normalized)` mientras `accepted_at` y `revoked_at` son NULL permite una sola invitación pendiente; como expiry no se incorpora con `now()` al predicate, re-invitar revoca primero la fila expirada en la misma transaction.

Acceptance bloquea Invitation, valida hash/expiry/lifecycle, Organization e intended email, y crea Membership con intended role solo si no existe `(organization_id,user_id)`. Una Membership existente produce conflicto o usa un workflow dedicado de reactivación/cambio de role; aceptar no cambia privilegios silenciosamente. Invitation queda accepted en la misma transaction que Membership, por lo que no puede reutilizarse ni elegir otra Organization.

Índices: UNIQUE `token_hash`; `(organization_id, intended_email_normalized, accepted_at, revoked_at)` para administración scoped; `(organization_id, created_at DESC, id DESC)` para listados internos; `expires_at` para cleanup.

### Persistent identity rate limiting

Se elige una tabla agregada pequeña, no un log de cada intento.

#### `identity_rate_limit_windows`

- `id` UUIDv7;
- `operation` CHECK (`Login`, `PasswordRecovery`, `Invitation`);
- `dimension` CHECK (`Identity`, `Network`, `IdentityNetwork`);
- `key_fingerprint bytea NOT NULL` y `fingerprint_version`;
- `window_started_at`, `expires_at`, `blocked_until` nullable;
- `attempt_count integer NOT NULL CHECK >= 0`;
- `created_at`, `updated_at`.

UNIQUE `(operation, dimension, key_fingerprint, window_started_at)`. Incremento/upsert es atómico. `expires_at > window_started_at`; `blocked_until`, si existe, es posterior al comienzo. No guarda email, IP o User-Agent raw. Como email/IP tienen baja entropía, el fingerprint usa HMAC con clave server-side versionada y purpose-separated; no un hash simple reversible por diccionario. Para Invitation el input del fingerprint puede incorporar Organization ID sin convertir la fila en recurso tenant.

La tabla es security-internal global y temporal. Protege restart de la instancia inicial, pero PostgreSQL no se usa como plataforma de throttling de alto volumen. Si aparecen múltiples replicas o carga sostenida, el adapter puede migrar a un store compartido sin cambiar reglas; Redis continúa fuera de V1.

Índices: UNIQUE de lookup; `expires_at` para cleanup y, solo si operaciones lo necesitan, `blocked_until` parcial para ventanas bloqueadas. No se crea un índice por cada metadata.

### Common token hashing

Session, Recovery e Invitation reciben secretos aleatorios de al menos 128 bits de entropía efectiva (se recomienda 256 bits) y URL-safe cuando corresponda. Browser/email recibe el secreto; PostgreSQL recibe solamente `SHA-256(purpose || separator || token)` calculado con una primitive mantenida. Purpose separation impide tratar un token de un flujo como otro. El digest determinista permite lookup indexado y se compara constant-time.

Esto es distinto de passwords: un token CSPRNG largo no es adivinable por diccionario y usa digest rápido para lookup; una password humana usa Argon2id con salt y work factor. No se crean algoritmos criptográficos propios. Los fingerprints de rate limiting sí son keyed HMAC porque sus inputs son predecibles.

### Security timestamps and lifecycle

Todos los instantes usan `timestamptz` UTC. Expiry se evalúa con tiempo autoritativo backend/database dentro de la operación; nunca con reloj del browser. `used_at`, `accepted_at` y `revoked_at` son hechos terminales e inmutables. Cambios de authorization version usan `updated_at` y Audit Record con timestamp efectivo.

Cleanup inicial combina:

- borrado oportunista acotado después de operaciones relacionadas, sin hacer scans completos;
- scheduled job simple futuro para Sessions expiradas, tokens usados/revocados/expirados, Invitations terminales/expiradas y rate windows vencidas;
- lotes con límite e índice de expiry para evitar locks prolongados;
- retención configurable de metadata terminal cuando sea necesaria para investigar abuso, sin retener secretos raw.

No requiere worker, broker ni Redis. El cleanup nunca determina validez: una fila expirada se rechaza aunque aún no haya sido purgada.

### Ownership, RLS and privileges

| Structure | Ownership | RLS V1 | Access model |
| --- | --- | --- | --- |
| Sessions | identidad global; Current Organization es contexto nullable | No | Identity repository; nunca recurso tenant normal |
| Password Recovery Tokens | User global | No | recovery service pre-auth; privilegios internos mínimos |
| Organization Invitations | Organization tenant-owned | No, excepción documentada | lookup pre-auth por secret; management siempre scoped y autorizado |
| Identity Rate Limit Windows | Security global; key puede incluir tenant en fingerprint | No | infraestructura de identidad; no API CRUD |

No aplicar RLS evita requerir Current Organization antes de autenticar/aceptar un token. Esto no habilita lecturas generales: adapters dedicados, grants mínimos, DTOs cerrados y tests impiden exponer filas. Invitations conserva `organization_id`, FKs y scoping para gestión. Si se separan roles de DB por módulo o aparece un flujo autenticado suficiente, se reevalúa RLS.

Son campos internos que nunca salen por APIs normales: token/fingerprint/password/session hashes, authorization versions internas, counters/windows, credential parameters innecesarios y metadata de revocación no requerida por el caso de uso. Las respuestas de recovery no revelan existencia de User o Invitation.

### Security ↔ Database traceability

| SECURITY requirement | Database mechanism |
| --- | --- |
| server-side sessions y revocación | `sessions`, token hash, absolute expiry, last seen y revoked timestamp |
| Current Organization validada | Session context + FK compuesta a Membership + Active check por request |
| permisos no stale | Membership authorization version + Session snapshot/revalidation |
| secure password recovery | dedicated recovery table, unique digest, expiry y one-time conditional update |
| tenant/email-bound invitation | Organization Invitation + intended email/role + Membership UNIQUE |
| identity abuse protection | aggregated expiring rate-limit windows con keyed fingerprints |
| secrets no persistidos | purpose-separated digest; raw token solo en browser/email |
| RLS fail-closed operational | policies tenant-owned existentes; exclusiones Identity explícitas y privilegiadas |
| data minimization | no raw IP/email en limiter y ningún security hash en API DTOs |

### BCM-005 database review

**Database Review Required:** Resolved.

Los cuatro gaps registrados por SECURITY.md quedan cubiertos: tokens de recovery/invitation; authorization version y Current Organization de Session; rate limiting persistente mínimo; constraints, ownership, indexes, cleanup y decisión RLS. La implementación futura todavía requiere Prisma schema y migrations revisadas, pero no queda una decisión conceptual de persistencia bloqueante atribuible a BCM-005.

## Pending database decisions

| ID | Decisión pendiente | Dependencia | Impacto / deadline |
| --- | --- | --- | --- |
| DB-DEC-001 | Cardinalidad V1 de Payments/Financing y reconciliación exacta con total/Trade-In | DOM-DEC-025, DOM-DEC-042, DOM-DEC-063 | Crítico; antes de implementar Sales |
| DB-DEC-002 | Unicidad funcional de SKU por Organization | Regla de Product/Domain | Medio; antes de implementar inventario Accessory |
| DB-DEC-003 | Status lifecycle definitivo de Accessories | DOM-DEC-046 | Alto; antes de implementar Accessories |
| DB-DEC-005 | Convención de exchange rate y reglas/momentos de redondeo | DOM-DEC-014 | Alto; antes de cualquier cálculo monetario |
| DB-DEC-007 | Ubicación/versionado de policy de tracking e IMEI obligatorio por definición de producto | DOM-DEC-040, DOM-DEC-060 | Alto; antes de catálogo/Equipment schema |
| DB-DEC-008 | Identificador fuerte y normalización para bloqueo de Customer duplicado | DOM-DEC-062 | Alto; antes de Customer constraints |
| DB-DEC-009 | Representación de Sale Correction, deltas, Payments y atribución temporal | DOM-DEC-056, DOM-DEC-054 | Crítico; antes de Sale Correction migration |
| DB-DEC-010 | Defaults/lifecycle y persistencia exacta de Customer/Supplier Warranty | DOM-DEC-064 | Alto; antes de Warranty migration |
| DB-DEC-011 | Estructura de Financing V1 y compatibilidad con Payment | DOM-DEC-063, DB-DEC-001 | Crítico; antes de Sales/Financing schema |
| DB-DEC-012 | Taxonomía Expense y tratamiento de inversiones en Business Result | DOM-DEC-066 | Alto; antes de Expense migration |

Estas decisiones no se rellenan con supuestos en el schema. Las columnas de extensibilidad no autorizan comportamientos de producto todavía pendientes.

## Resolved database decisions

| ID | Decision | Resolution | Source |
| --- | --- | --- | --- |
| DB-DEC-006 | Policies RLS de bootstrap y administración cross-tenant | Organizations, Memberships y tablas internas globales de Identity quedan fuera de RLS operativa inicial; repositories estrictos, grants mínimos y capabilities de plataforma separadas. Invitations conserva tenant scope pero se excluye por acceptance pre-auth. | BCM-005 / BCM-005A |
| DB-DEC-004 | Status inicial del Equipment recibido por Trade-In | `Available`; no pasa automáticamente por `UnderReview`. La relación Sale 1:N Trade-In ya soporta múltiples equipos recibidos. | BCM-012A / DOM-DEC-012 / DOM-DEC-041 |

## Architecture review

**Architecture Review Required:** Yes, before implementation of Expenses, Warranty or Financing boundaries.

Las decisiones continúan compatibles con el modular monolith, PostgreSQL compartido con tenant identifiers explícitos, sesiones server-side, RBAC simple, Prisma con SQL controlado y ausencia inicial de Redis/broker. Sin embargo, Expenses, Warranty y Financing son capacidades nuevas/no detalladas en la lista de módulos aceptada: antes de código debe revisarse su ownership y dependencia entre módulos sin cambiar la topología por defecto. BCM-012A no modifica `ARCHITECTURE.md` ni aprueba esa revisión.

## Database review checklist

- [x] Toda tabla tenant-owned declara Organization y FKs tenant-aware.
- [x] Dinero, moneda, exchange rates y snapshots tienen representación explícita.
- [x] IMEI nullable conserva NULL y unicidad parcial por tenant.
- [x] Sales, Reservations, Payments y Trade-Ins tienen cardinalidades y pendientes visibles.
- [x] Multiple Trade-Ins es 1:N y received Equipment inicia Available.
- [x] Sale Correction conserva original y bloquea schema final detrás de DB-DEC-009.
- [x] Expenses, Warranty, stock minimum y Customer duplicate tienen impacto/gates visibles.
- [x] Stock, WAC, reservas y venta de Equipment tienen estrategia de concurrencia.
- [x] Reversión conserva historia mediante compensaciones.
- [x] RLS tiene alcance V1 y límites con pooling/Prisma.
- [x] Constraints, índices, transacciones y referential actions están catalogados.
- [x] Migrations, seeds, backup/restore y crecimiento están contemplados.
- [x] Recovery, Invitations, Session authorization context y abuse windows tienen lifecycle, constraints e índices.
- [x] Nuevas estructuras de Identity tienen ownership, exposure y decisión RLS explícitos.
- [x] No se agregaron entidades fuera del producto ni infraestructura no aprobada.

## Review against prior phases

Revisión obligatoria realizada contra `PRODUCT.md`, `DOMAIN.md`, `ARCHITECTURE.md`, `SECURITY.md` y todos los ADRs vigentes:

- preserva aislamiento multi-tenant y soporte multi-Organization por User;
- refleja unicidad IMEI tenant-aware y ausencia permitida;
- mantiene Customer opcional en Sale y obligatorio en Reservation/Trade-In;
- separa trazabilidad de Equipment de stock agregado de Accessories;
- conserva costos históricos, exchange snapshots y gross profit potencialmente negativo;
- implementa Sale/Reservation como transiciones atómicas y reversibles;
- no introduce descuentos, comisiones, proveedores avanzados ni compras;
- no cierra decisiones de dominio marcadas como pendientes;
- incorpora requisitos persistentes de SECURITY.md sin exponer hashes o crear IAM/rate limiting genéricos.

La contradicción entre edición/eliminación solicitada y snapshots inmutables se resolvió mediante Sale Correction y business void compensatorio. Los asuntos abiertos están enumerados como DB-DEC y vinculados a su fase de resolución.

## Completion status

**Estado:** Completed

BCM-004, BCM-005A y la reconciliación BCM-012A definen el diseño lógico de PostgreSQL y sus garantías, sin crear schema Prisma, migrations, base ejecutable ni código de aplicación.
