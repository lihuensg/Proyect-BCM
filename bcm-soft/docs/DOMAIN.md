# BCM SOFT — Domain Definition

**Estado:** Completed  
**Fase:** BCM-002 — Domain Definition  
**Última actualización:** BCM-002B — Returns Scope Decision

Este documento define cómo funciona el negocio de BCM SOFT. Traduce la definición funcional de `PRODUCT.md` a conceptos, relaciones, estados, transiciones, operaciones, invariantes y eventos de dominio, sin establecer decisiones técnicas o de implementación.

Cuando una regla no está respaldada por la definición vigente, se identifica como `Decision Pending`. Una alternativa indicada junto a esa marca es una propuesta para análisis, no una decisión aprobada.

## 1. Contexto de dominio

BCM SOFT es un producto de gestión comercial reutilizable. BCM es el primer negocio que utilizará el producto, pero no es el producto ni define por sí solo todas las reglas aplicables a futuros negocios.

El dominio inicial comprende comercios dedicados a comprar y vender celulares, tablets, notebooks, MacBook, smartwatches, accesorios y otros productos tecnológicos relacionados.

Cada **Organization / Business** es propietaria funcional de su información comercial. En el futuro podrán coexistir múltiples negocios independientes. Este documento define esa independencia como regla del negocio, sin determinar cómo se consigue técnicamente.

### 1.1. Límites funcionales de V1

V1 abarca inventario de equipos y accesorios, ventas, clientes, proveedores básicos, reservas, plan canje, monedas y cotizaciones, catálogos, lista de precios, dashboard básico, usuarios y auditoría funcional.

Compras avanzadas, devoluciones, garantías avanzadas, financiamiento avanzado, múltiples sucursales y otras capacidades excluidas o pendientes no adquieren reglas definitivas en este documento.

### 1.2. Convención terminológica

Este documento utiliza un nombre conceptual en inglés y su equivalente funcional en español cuando ayuda a evitar ambigüedades. Por ejemplo, **Equipment (Equipo)** identifica una unidad física individual y **Accessory Product (Producto accesorio)** identifica un producto gestionado por cantidad.

La convención solo normaliza el vocabulario del dominio. No prescribe nombres de código ni estructuras técnicas.

## 2. Glosario de dominio

| Concepto | Definición funcional |
|---|---|
| **Organization / Business (Negocio)** | Comercio que utiliza BCM SOFT y es propietario funcional de su inventario, operaciones, clientes, proveedores, configuraciones y usuarios. |
| **User (Usuario)** | Persona que actúa en nombre de un negocio de acuerdo con permisos funcionales todavía sujetos a definición detallada. |
| **Equipment (Equipo)** | Unidad física individual administrada por separado, aun cuando comparta modelo y características con otras unidades. |
| **Accessory Product (Producto accesorio)** | Producto agregado cuya existencia se controla mediante cantidades, no mediante identidad individual por unidad. |
| **Inventory (Inventario)** | Conjunto de equipos y productos accesorios pertenecientes a un negocio, junto con su situación de disponibilidad. |
| **Inventory Availability (Disponibilidad)** | Condición funcional que determina si un equipo o una cantidad de accesorios puede participar en una nueva operación. |
| **Customer (Cliente)** | Persona vinculada con ventas, reservas, planes canje y futuras operaciones comerciales. |
| **Supplier (Proveedor)** | Persona o negocio que puede originar futuras compras o ingresos de inventario; en V1 se administra de forma básica. |
| **Sale (Venta)** | Operación comercial que registra la entrega de equipos o accesorios y sus condiciones económicas. |
| **Sale Item (Ítem de venta)** | Componente de una venta que representa un equipo individual o una cantidad de un producto accesorio, con sus valores comerciales históricos. |
| **Payment (Pago)** | Información económica sobre el medio y la moneda mediante los cuales se satisface el importe de una venta. La multiplicidad y composición de pagos es `Decision Pending`. |
| **Currency (Moneda)** | Unidad monetaria en la que se expresa un valor. Las monedas iniciales son USD y ARS. |
| **Exchange Rate (Cotización)** | Relación utilizada para interpretar o convertir valores entre ARS y USD en una operación concreta. |
| **Reservation (Reserva)** | Asignación temporal de un equipo a un cliente, que impide tratarlo como disponible para otra operación mientras esté activa. |
| **Deposit / Seña** | Monto asociado a una reserva. Sus efectos ante conversión, cancelación o vencimiento son `Decision Pending`. |
| **Trade-In (Plan canje)** | Parte de una venta mediante la cual el cliente entrega un equipo con un valor de toma que reduce el saldo a pagar. |
| **Trade-In Equipment (Equipo recibido)** | Equipo entregado por el cliente en un plan canje, incorporado al inventario y relacionado con la venta de origen. |
| **Price (Precio)** | Valor solicitado o acordado por la entrega de un producto. Se distingue entre precio de referencia y precio final. |
| **Cost (Costo)** | Valor económico histórico asociado al ingreso o adquisición de un producto. |
| **Profit (Rentabilidad)** | Resultado económico analizado principalmente en USD a partir del precio final y el costo histórico, sujeto a reglas pendientes para casos complejos. |
| **Catalog (Catálogo)** | Conjunto configurable de valores comerciales reutilizables, como marcas, modelos, capacidades o medios de pago. |
| **Product Status (Estado de producto)** | Situación funcional actual de un equipo o producto accesorio que condiciona su uso comercial. |
| **Inventory Movement (Movimiento de inventario)** | Explicación funcional de un cambio de cantidad, estado o disponibilidad del inventario. |
| **Audit Event (Evento de auditoría)** | Registro funcional de una acción sensible que permite responder quién hizo qué, cuándo, sobre qué y, cuando corresponda, por qué. |
| **Domain Event (Evento de dominio)** | Hecho significativo que ocurrió en el negocio, expresado de forma conceptual y sin implicar un mecanismo técnico. |

## 3. Organization / Business

### 3.1. Responsabilidad

Cada negocio posee funcionalmente su propia información:

- inventario;
- ventas y sus ítems;
- clientes;
- proveedores;
- reservas y señas;
- configuraciones y catálogos;
- usuarios;
- movimientos de inventario;
- eventos de auditoría;
- demás operaciones comerciales.

La información de un negocio no forma parte funcionalmente de otro negocio. Una operación nunca debe combinar datos pertenecientes a negocios diferentes.

### 3.2. Relaciones principales

- Un negocio tiene usuarios que actúan en su nombre.
- Un negocio administra equipos y productos accesorios en su inventario.
- Un negocio registra clientes y proveedores propios.
- Las ventas y reservas ocurren dentro de un único negocio.
- Los catálogos y la cotización de referencia pertenecen al contexto funcional del negocio.
- Los movimientos de inventario y eventos de auditoría explican acciones ocurridas dentro del mismo negocio.

### 3.3. Reglas

1. Todo concepto comercial debe pertenecer funcionalmente a un negocio.
2. Una relación entre conceptos comerciales solo es válida cuando todos pertenecen al mismo negocio.
3. El historial de un negocio debe permanecer independiente del historial de cualquier otro.
4. Los roles, permisos detallados y mecanismos de aislamiento son `Decision Pending` para fases posteriores.

### 3.4. User

Un **User** es una persona que actúa en nombre de un negocio. Sus acciones comerciales siempre ocurren dentro del contexto funcional de ese negocio.

Los tipos iniciales contemplados por producto son dueño, administrador, vendedor y usuario de consulta. Estos nombres expresan necesidades funcionales, pero todavía no constituyen una matriz aprobada de permisos.

- Un usuario puede originar operaciones y acciones auditables.
- Una acción sensible debe poder atribuirse al usuario que la realizó cuando corresponda.
- Un usuario no adquiere acceso funcional a la información de otro negocio por el solo hecho de existir en BCM SOFT.
- La posibilidad de que una persona participe en más de un negocio, sus roles y permisos detallados son `Decision Pending`.

## 4. Equipment

### 4.1. Definición y responsabilidad

Un **Equipment** representa una unidad física individual. Dos equipos del mismo modelo siguen siendo conceptos distintos si el negocio los administra individualmente. Cada unidad conserva su propia identidad, condición, costo, precio, estado, origen y trazabilidad.

Ejemplos: un iPhone específico, una MacBook específica o una tablet específica.

### 4.2. Clasificación funcional de atributos

| Categoría | Atributos | Significado |
|---|---|---|
| **Identificativos** | categoría, marca, modelo, capacidad, color, IMEI u otro identificador | Permiten reconocer y distinguir la unidad. El IMEI aplica solo cuando corresponde. |
| **Comerciales** | costo, precio de referencia, origen | Explican su valoración y procedencia comercial. |
| **Variables** | salud de batería, condición funcional, condición estética, estado, observaciones, fotografías | Pueden cambiar durante la vida del equipo sin reemplazar su identidad. |
| **Históricos** | costo de ingreso, cotización asociada cuando corresponda, origen, venta de salida, reserva y plan canje relacionados | Deben conservar el significado de operaciones pasadas aunque cambien valores actuales. |

Un atributo puede ser variable en el presente y, a la vez, requerir trazabilidad histórica cuando participa en una operación. El detalle exacto del historial de cambios es `Decision Pending`.

### 4.3. Origen

El origen explica cómo ingresó el equipo al inventario, por ejemplo ingreso manual, plan canje, futura compra, devolución o ajuste. V1 define explícitamente el ingreso manual y el ingreso por plan canje; las reglas de otros orígenes permanecen pendientes.

## 5. Estados de Equipment

### 5.1. Significado funcional

| Estado | Significado |
|---|---|
| **Available** | El equipo está habilitado funcionalmente para una nueva venta o reserva. |
| **Reserved** | El equipo está asignado a una reserva activa y no debe ofrecerse a otra operación como disponible. |
| **Sold** | El equipo forma parte de una venta confirmada y ya no está disponible para una venta normal. |
| **Under Review** | El equipo está apartado de la comercialización mientras se revisa su condición o situación. |
| **Archived** | El equipo se conserva como referencia histórica o queda fuera de la operación activa. Sus causas y posibles salidas son `Decision Pending`. |

### 5.2. Matriz de transiciones

Leyenda:

- **Defined:** respaldada por `PRODUCT.md`.
- **Conditional:** existe conceptualmente, pero requiere una condición u operación específica.
- **Not allowed:** contradice una invariante vigente.
- **Decision Pending:** no existe una regla suficiente para autorizarla.

| Desde / hacia | Available | Reserved | Sold | Under Review | Archived |
|---|---:|---:|---:|---:|---:|
| **Available** | Sin cambio | Defined: crear reserva | Defined: confirmar venta | Defined: enviar a revisión | Decision Pending |
| **Reserved** | Conditional: cancelar reserva cuando corresponda | Sin cambio | Conditional: convertir reserva en venta | Decision Pending | Decision Pending |
| **Sold** | Conditional: cancelación o reversión válida cuando todos los elementos sean reversibles | Not allowed en operación normal | Sin cambio | Decision Pending | Decision Pending |
| **Under Review** | Defined: finalizar revisión y habilitar | Decision Pending | Decision Pending | Sin cambio | Decision Pending |
| **Archived** | Decision Pending | Decision Pending | Decision Pending | Decision Pending | Sin cambio |

### 5.3. Transiciones y causas conocidas

- `Available → Reserved`: creación de una reserva activa.
- `Available → Sold`: confirmación de una venta normal.
- `Reserved → Available`: cancelación de la reserva cuando la política aplicable libera el equipo.
- `Reserved → Sold`: conversión de la reserva en venta para el mismo Customer asociado.
- `Available → Under Review`: decisión operativa de retirar temporalmente el equipo de la venta.
- `Under Review → Available`: revisión finalizada con resultado apto para comercialización.
- `Sold → estado anterior correspondiente`: nunca ocurre como edición ordinaria; solo mediante cancelación o reversión válida cuando todos los elementos siguen siendo reversibles. El estado suele ser `Available`, salvo que una situación posterior lo impida.

Toda transición no incluida como conocida requiere definición previa. No se asume que exista una transición solo porque ambos estados estén definidos.

## 6. Invariantes de Equipment

1. Un equipo representa exactamente una unidad física individual.
2. Un equipo no puede estar simultáneamente `Available` y `Sold`.
3. Un equipo `Sold` no puede venderse nuevamente mediante una venta normal.
4. Un equipo `Reserved` no puede tratarse como disponible para otra operación.
5. Un equipo no puede formar parte de dos ventas confirmadas vigentes simultáneamente.
6. Un equipo no puede tener dos reservas activas simultáneamente.
7. Toda transición de estado debe originarse en una operación válida o en una modificación autorizada y explicable.
8. Un cambio de estado no debe borrar la operación que originó el estado anterior cuando esa operación sea histórica.
9. Cuando un equipo posea IMEI, ese IMEI debe ser único dentro del mismo negocio. No pueden existir dos equipos históricos diferentes con el mismo IMEI salvo una futura política explícita de corrección de datos.
10. Un equipo recibido mediante plan canje debe conservar la relación con la venta que originó su ingreso.

## 7. Accessory Product

### 7.1. Definición y responsabilidad

Un **Accessory Product** representa un producto administrado por cantidad. Las unidades equivalentes no se individualizan como ocurre con Equipment.

Ejemplos: 20 fundas de una variante, 15 vidrios de un tipo o 8 cables de un modelo.

### 7.2. Información funcional

- **Identificación comercial:** categoría, nombre, marca, variante y SKU.
- **Valores comerciales:** costo y precio de referencia.
- **Disponibilidad:** estado y cantidad disponible.
- **Descripción:** datos adicionales, comentarios y fotografías.

La unicidad y obligatoriedad del SKU son `Decision Pending`. El historial de costo y precio utilizado en cada venta pertenece a la operación, no depende de los valores actuales del producto.

`PRODUCT.md` incluye un estado para Accessory Product, pero no define sus valores ni transiciones. Hasta resolver `DOM-DEC-046`, ningún conjunto de estados se considera aprobado. Como mínimo, el estado deberá permitir distinguir si el producto puede utilizarse en nuevas operaciones sin alterar su historia.

### 7.3. Diferencia con Equipment

| Equipment | Accessory Product |
|---|---|
| Representa una unidad individual. | Representa un tipo o variante agregado. |
| Su disponibilidad depende principalmente de su estado. | Su disponibilidad depende principalmente de una cantidad vendible y de su estado. |
| Una venta relaciona la unidad específica. | Una venta relaciona el producto y la cantidad consumida. |
| Puede tener IMEI u otro identificador individual. | Puede tener SKU, que identifica el producto o variante, no cada unidad física. |

## 8. Inventario e invariantes de accesorios

### 8.1. Conceptos de stock

- **Stock disponible:** cantidad que puede consumirse en una nueva venta confirmada.
- **Stock físico:** cantidad que se considera físicamente presente. Su relación exacta con ajustes, pérdidas u otras situaciones es `Decision Pending`.
- **Stock reservado:** cantidad apartada para una operación futura. Las reservas de accesorios no están definidas en V1; por lo tanto, este concepto no se considera una capacidad vigente y queda como `Decision Pending`.

Mientras no se defina stock reservado, la cantidad disponible es la referencia funcional para vender accesorios, sin asumir una fórmula adicional entre categorías de stock.

### 8.2. Invariantes

1. El stock de accesorios nunca puede ser negativo.
2. Una venta solo puede consumir cantidad disponible.
3. La cantidad de una línea de accesorio debe ser mayor que cero para confirmarse.
4. Una reversión válida debe restituir exactamente las cantidades que corresponda restituir.
5. Modificar o revertir una operación anterior debe preservar la consistencia del stock.
6. Todo cambio relevante de cantidad debe tener una causa explicable mediante un movimiento de inventario.
7. Un precio final cero es válido para un regalo, pero no evita el descuento de stock ni elimina el costo histórico.
8. El comportamiento de un producto accesorio archivado o inactivo es `Decision Pending`.

### 8.3. Inventory Availability

La presencia de un producto en el inventario no implica necesariamente que esté disponible para comercialización.

- Un Equipment solo se considera disponible para una nueva operación cuando está `Available`.
- Un Accessory Product requiere cantidad disponible mayor que cero y un estado que permita venderlo; los estados concretos están pendientes.
- Un Equipment `Reserved`, `Sold`, `Under Review` o `Archived` no forma parte de la disponibilidad comercial normal.
- La lista de precios solo puede mostrar productos disponibles para comercialización.
- Los cambios de reserva, venta, revisión, ajuste y reversión deben reflejarse coherentemente en la disponibilidad.

## 9. Customer

### 9.1. Definición y responsabilidad

Un **Customer** identifica a la persona vinculada con operaciones comerciales del negocio. Centraliza su identidad básica, información de contacto y relaciones con ventas, reservas, planes canje y futuras financiaciones.

### 9.2. Reglas históricas

- Editar la información actual de un cliente no debe eliminar sus operaciones anteriores.
- Desactivar o dejar de utilizar un cliente no debe romper la trazabilidad de ventas y reservas históricas.
- Una operación histórica debe seguir permitiendo identificar con qué cliente se realizó, aun si luego cambian sus datos actuales.
- Qué datos del cliente deben conservarse exactamente como parte del contexto histórico de cada operación es `Decision Pending`.
- La eliminación funcional, desactivación y posible anonimización de clientes requieren reglas posteriores.

### 9.3. Relaciones

- Un cliente puede tener múltiples ventas.
- Un cliente puede tener múltiples reservas a lo largo del tiempo, pero no dos reservas activas sobre el mismo equipo.
- Un cliente puede entregar equipos mediante plan canje dentro de una venta.
- Una venta estándar puede confirmarse sin cliente identificado.
- Toda Reservation y todo Trade-In requieren un cliente identificado.
- Financing y Warranty requerirán cliente cuando esas capacidades futuras sean definidas.

## 10. Supplier

Un **Supplier** representa a una persona o negocio que puede proveer productos al negocio. V1 contempla únicamente su gestión básica mediante nombre, contacto, teléfono, país y observaciones.

Las relaciones con compras, ingresos de inventario y costos se consideran evolución futura. Registrar un proveedor no implica que exista en V1 una compra, una cuenta corriente ni un movimiento financiero.

Son `Decision Pending`:

- el modelo funcional de compras;
- la relación obligatoria u opcional entre un ingreso manual y un proveedor;
- la conservación de costos y cotizaciones de una compra;
- devoluciones a proveedores;
- saldos o pagos a proveedores.

## 11. Sale

### 11.1. Definición y composición

Una **Sale** es una operación comercial del negocio que registra la entrega de uno o más equipos, accesorios o ambos, junto con su contexto económico.

Puede incluir:

- uno o más equipos;
- múltiples productos accesorios y cantidades;
- cliente;
- precios de referencia y finales;
- descuentos;
- regalos con precio final cero;
- moneda y cotización cuando corresponda;
- medio de pago;
- observaciones;
- uno o más componentes de plan canje, cuya multiplicidad exacta es `Decision Pending`.

`PRODUCT.md` confirma que una venta puede contener uno o más equipos. Cualquier límite máximo o restricción de combinación permanece pendiente.

### 11.2. Sale Item

Un **Sale Item** conserva el significado comercial de cada componente vendido:

- Para Equipment, relaciona una unidad individual y conceptualmente representa cantidad uno.
- Para Accessory Product, relaciona un producto, una cantidad positiva, precio de referencia, precio final y descuento cuando corresponda.
- Conserva el precio final acordado y el costo histórico relevante para rentabilidad.
- Un ítem de accesorio puede tener precio final cero como regalo.

La forma de representar descuentos sobre toda la venta, en lugar de sobre un ítem, es `Decision Pending`.

### 11.3. Ciclo de vida funcional

El ciclo de vida funcional inicial adopta tres estados oficiales:

| Estado | Significado funcional |
|---|---|
| **Draft** | Preparación editable que todavía no representa una operación comercial confirmada y no produce efectos definitivos sobre inventario. Puede eliminarse mientras no haya producido efectos comerciales. |
| **Confirmed** | Operación comercial realizada que produjo sus efectos sobre inventario y módulos relacionados. Sus valores históricos se preservan y no puede editarse libremente. |
| **Cancelled** | Venta confirmada posteriormente anulada mediante una operación explícita. Conserva su historia, la cancelación y los efectos compensatorios aplicables. |

Las transiciones normales son:

- `Draft → Confirmed`: confirmación coherente de la operación.
- `Draft → eliminado`: permitido porque todavía no existen efectos comerciales definitivos.
- `Confirmed → Cancelled`: cancelación explícita, trazable e idempotente.

Una venta `Confirmed` o `Cancelled` no se elimina físicamente como comportamiento normal. Una venta `Cancelled` no vuelve a cancelarse como una nueva cancelación normal.

### 11.4. Payment

V1 reconoce como medios iniciales efectivo, transferencia, tarjeta y otro. La venta conserva el medio, la moneda y la cotización utilizados cuando corresponda.

Son `Decision Pending` los pagos combinados, pagos parciales, diferencias entre momento de pago y confirmación, referencias de pago, cuotas y financiamiento.

### 11.5. Historial económico

Toda Sale `Confirmed` conserva como mínimo los valores utilizados al confirmarse:

- precio final;
- costo histórico aplicado;
- moneda;
- cotización cuando existe conversión;
- valor de Trade-In;
- cantidades;
- descuentos relevantes.

Los valores actuales de catálogos, precios, costos o cotizaciones no reescriben estos valores históricos.

## 12. Confirmación de venta

Confirmar una venta significa reconocerla como una operación comercial coherente y producir todos sus efectos funcionales como un solo conjunto.

### 12.1. Precondiciones conocidas

- Cada equipo debe encontrarse en un estado que permita su venta.
- Cada cantidad de accesorio debe estar disponible.
- Los valores económicos requeridos deben ser válidos.
- Si la moneda es ARS, debe existir una cotización válida y positiva asociada a la operación.
- Los conceptos relacionados deben pertenecer al mismo negocio.
- El Customer es opcional en una venta estándar, pero obligatorio cuando la operación incluye Reservation o Trade-In.
- La regla sobre venta vacía continúa como `Decision Pending`.

### 12.2. Efectos inseparables

- Los equipos vendidos pasan al estado `Sold` y dejan de estar disponibles.
- Las cantidades vendidas de accesorios disminuyen.
- Los equipos recibidos mediante plan canje ingresan al inventario, conservan su valor de toma como costo inicial y se relacionan con la venta.
- Los precios finales, costos históricos, moneda, cotización y medio de pago quedan asociados al significado histórico de la venta.
- La operación pasa a formar parte del historial del cliente cuando existe cliente asociado.
- Se originan movimientos de inventario y trazabilidad funcional explicables.

Una confirmación no es válida si solo ocurre una parte de estos efectos y el resto queda incoherente. La forma técnica de garantizar esta unidad pertenece a fases posteriores.

### 12.3. Errores esperables

- equipo no disponible o ya vendido;
- equipo reservado sin una conversión válida;
- stock insuficiente de accesorios;
- cantidad no válida;
- cotización ausente, cero o negativa para una operación que la requiere;
- mezcla de información perteneciente a negocios diferentes;
- equipo de plan canje duplicado;
- datos obligatorios incompletos según decisiones todavía pendientes;
- conflicto porque otra operación modificó previamente la disponibilidad.

Ante un error, la venta no debe quedar parcialmente confirmada.

## 13. Venta de Equipment

### 13.1. Reglas definidas

1. Un equipo `Available` puede incluirse en una venta.
2. Al confirmarse la venta, pasa a `Sold`.
3. Un equipo `Sold` no puede venderse nuevamente mediante una venta normal.
4. Una misma unidad no puede participar en dos ventas confirmadas vigentes.
5. La venta debe conservar la identidad de la unidad vendida y su costo histórico relevante.

### 13.2. Equipment reservado

Un equipo `Reserved` no puede venderse mediante el flujo normal como si estuviera `Available`.

La forma válida inicial es convertir la Reservation en Sale mediante `Reserved → Sold`. La venta debe corresponder al Customer asociado a la reserva.

Para vender el equipo a otra persona, primero debe cancelarse o liberarse explícitamente la reserva conforme a una operación válida. Solo después el equipo podrá venderse mediante una nueva venta.

El tratamiento de la seña durante la conversión y el vencimiento de reservas permanecen como `Decision Pending`.

## 14. Venta de accesorios

Una venta puede contener múltiples líneas de accesorios. Cada línea registra funcionalmente:

- producto accesorio;
- cantidad positiva;
- precio de referencia;
- precio final;
- descuento cuando corresponda;
- costo histórico relevante.

### 14.1. Reglas

1. La cantidad total vendida no puede superar el stock disponible.
2. La confirmación descuenta la cantidad vendida.
3. El precio final puede diferir del precio de referencia.
4. El precio final cero es válido para regalos.
5. Un regalo conserva su costo histórico y produce salida de stock.
6. Una reversión válida restituye la cantidad que corresponda sin duplicarla.
7. Las reservas de stock de accesorios no forman parte del alcance definido y son `Decision Pending`.

## 15. Moneda y cotización

### 15.1. Conceptos

- **Moneda comercial principal:** USD.
- **Moneda alternativa inicial:** ARS.
- **Cotización general o de referencia:** valor actual configurable que puede utilizarse para iniciar una operación.
- **Cotización de operación:** valor efectivamente utilizado y conservado por una operación histórica.

### 15.2. Reglas históricas

1. Una operación puede registrarse en USD o ARS.
2. Cuando se utiliza ARS mediante cotización, la operación debe conservar la cotización utilizada.
3. La cotización de operación debe ser positiva.
4. Cambiar posteriormente la cotización general no altera el significado económico de operaciones anteriores.
5. Los análisis históricos deben utilizar los valores y cotizaciones conservados por cada operación, no la referencia actual.

### 15.3. Cotización general y decisiones pendientes

La cotización general configurada por el negocio es únicamente el valor predeterminado o sugerido para nuevas operaciones. Cada operación económica que convierta entre ARS y USD conserva la cotización efectivamente utilizada.

Cambiar la cotización general no modifica ventas, costos históricos, Trade-Ins, reservas históricas ni otros valores económicos ya confirmados.

Permanecen como `Decision Pending`:

- criterio y dirección exacta de la cotización;
- cantidad de decimales y reglas de redondeo;
- tipo de dólar utilizado;
- frecuencia y permisos de actualización manual;
- uso futuro de fuentes externas;
- tratamiento de diferencias de cambio;
- posibilidad de precios y pagos expresados en monedas distintas dentro de una misma venta.

## 16. Cost

El **Cost** es el valor económico asociado al ingreso o adquisición de un producto. Debe conservarse históricamente para interpretar la rentabilidad de su salida.

### 16.1. Variantes funcionales

- **Costo en USD:** valor expresado directamente en la moneda comercial principal.
- **Costo en ARS:** valor expresado en ARS junto con la cotización utilizada para interpretarlo históricamente.
- **Costo de plan canje:** valor de toma acordado para el equipo recibido, utilizado inicialmente como su costo funcional.
- **Costo histórico:** valor aplicable al momento de la operación, que no cambia por editar el costo actual del producto.

### 16.2. Specific Historical Cost para Equipment

Cada Equipment conserva su costo histórico individual. Dos equipos del mismo modelo pueden tener costos diferentes y no se promedian entre sí.

Cuando se vende un Equipment, la venta conserva el costo específico de esa unidad en el momento de la confirmación. Cambiar posteriormente costos de referencia de equipos similares no modifica la venta histórica.

### 16.3. Moving Weighted Average Cost para Accessory Product

V1 adopta **Moving Weighted Average Cost (Costo Promedio Ponderado Móvil)** para accesorios.

Ante un nuevo ingreso a distinto costo, el costo unitario promedio se recalcula conceptualmente como:

`(valor total previo del inventario + valor del nuevo ingreso) / cantidad total resultante`

Las ventas posteriores consumen costo utilizando el promedio vigente en el momento correspondiente. Cada venta conserva el costo aplicado al confirmarse; un recálculo futuro no modifica ventas anteriores.

V1 no utiliza FIFO ni LIFO para accesorios.

### 16.4. Reglas y pendientes

- Una venta debe conservar el costo histórico necesario para su análisis posterior.
- Un cambio del costo actual no reescribe ventas anteriores.
- Si costo cero es válido o representa información faltante es `Decision Pending`.
- Costos adicionales, reposición y distribución de costos no están definidos.
- Los costos de reparación o reacondicionamiento de un Trade-In permanecen como `Decision Pending`.

## 17. Price

### 17.1. Precio de referencia

Valor comercial vigente utilizado como punto de partida al preparar una venta o una lista de precios. Puede cambiar con el tiempo.

### 17.2. Precio final

Valor acordado para un ítem dentro de una venta. Puede diferir del precio de referencia por descuento, negociación o regalo.

### 17.3. Reglas

1. La venta conserva el precio de referencia utilizado y el precio final acordado cuando ambos resulten aplicables.
2. Cambiar el precio de referencia actual no modifica una venta histórica.
3. El precio final cero es válido para un accesorio entregado como regalo.
4. Si un equipo puede venderse a precio cero es `Decision Pending`.
5. Reglas de autorización para descuentos o precios personalizados son `Decision Pending`.

## 18. Profit

La métrica principal de producto para BCM SOFT V1 es **Gross Profit USD**.

### 18.1. Definición base V1

Conceptualmente:

`Gross Profit USD = ingresos económicos reconocidos de la venta en USD − costo histórico de los productos entregados en USD`

Gross Profit USD es margen bruto del producto. No representa flujo de caja, utilidad contable, impuestos, gastos operativos, comisiones ni costos financieros. Esas métricas quedan fuera de la definición base V1.

### 18.2. Equipment

Para cada Equipment vendido:

`Gross Profit USD del Equipment = precio final de venta en USD − costo histórico específico en USD`

Cada unidad utiliza su propio costo. Cambiar el costo de referencia de productos similares no modifica el resultado histórico.

### 18.3. Accessory Product y regalos

Cada accesorio vendido utiliza el Moving Weighted Average Cost vigente al momento de la venta. El costo aplicado queda preservado históricamente.

Un accesorio regalado tiene precio final USD 0, disminuye inventario y conserva costo. Por lo tanto, reduce el Gross Profit USD de la venta por el importe de su costo histórico.

Ejemplo: un Equipment vendido a USD 500 con costo USD 350 y un accesorio regalado con costo USD 10 produce Gross Profit USD 140.

### 18.4. Trade-In

Un Trade-In es simultáneamente parte de la contraprestación económica de la venta y el ingreso de un nuevo activo al inventario.

Ejemplo: ante un precio acordado de USD 500, un Trade-In valuado en USD 100 y un saldo pagado en dinero de USD 400, el valor económico reconocido de la venta sigue siendo USD 500. El valor de toma no se contabiliza nuevamente como un gasto adicional del margen de esa venta.

El Equipment recibido ingresa con costo histórico inicial igual a su valor de toma. Su propia rentabilidad se reconoce cuando posteriormente se venda, evitando doble contabilización.

### 18.5. Reglas históricas y pendientes

- Los valores en ARS se interpretan con la cotización histórica de la operación para analizarlos en USD.
- Descuentos y precios personalizados afectan el ingreso económico reconocido.
- Cambiar costos, precios o cotizaciones actuales no modifica el Gross Profit USD histórico.
- Redondeos, diferencias de cambio y precisión monetaria permanecen como `Decision Pending`.
- Comisiones, impuestos, gastos operativos, costos financieros y otras métricas extendidas quedan fuera de la definición base V1.
- Rentabilidad ante devoluciones o cancelaciones se definirá junto con las políticas completas de esas capacidades.
- Períodos, agrupaciones y momento de reconocimiento para el dashboard permanecen pendientes.

## 19. Reservation

Una **Reservation** es la asignación temporal de un equipo a un cliente. Mientras esté activa, modifica la disponibilidad del equipo sin representar todavía una venta.

### 19.1. Información funcional

- Equipment;
- Customer;
- Deposit / seña;
- fecha;
- observaciones;
- estado conceptual.

### 19.2. Estados V1

V1 adopta los siguientes estados funcionales:

| Estado | Significado |
|---|---|
| **Active** | Mantiene el equipo asignado al Customer y en estado `Reserved`. |
| **ConvertedToSale** | Finalizó mediante una venta relacionada con el mismo Customer. |
| **Cancelled** | Finalizó por cancelación explícita sin convertirse en venta. |

`Expired` queda como capacidad futura y `Decision Pending` hasta definir vencimiento automático y sus efectos.

### 19.3. Deposit / Seña

La seña es un monto registrado con la reserva. No se define todavía como pago parcial definitivo, ingreso reconocido, importe reembolsable o penalidad.

Son `Decision Pending`:

- moneda y cotización de la seña;
- aplicación de la seña al convertir la reserva en venta;
- devolución total o parcial;
- pérdida de la seña;
- tratamiento ante cancelación o vencimiento;
- registro de señas adicionales;
- modificación de su monto.

## 20. Invariantes de Reservation

1. Una reserva activa debe relacionar exactamente un equipo individual y un cliente.
2. Un equipo con reserva activa no debe estar disponible para otro cliente.
3. Un equipo no puede tener dos reservas activas simultáneamente.
4. Crear una reserva activa cambia el equipo de `Available` a `Reserved`.
5. Cancelar una reserva debe liberar el equipo cuando corresponda, sin borrar la trazabilidad de la reserva.
6. Convertir una reserva en venta debe evitar que el equipo quede simultáneamente reservado y vendido.
7. Una reserva ya convertida no puede cancelarse como si continuara activa.
8. Una reserva finalizada no debe reactivarse sin una regla explícita; esa regla es `Decision Pending`.
9. La extensión, modificación y expiración de reservas son `Decision Pending`.
10. La política de señas es `Decision Pending` y no debe inferirse de la transición de estado.

## 21. Trade-In

Un **Trade-In** es un componente de una venta mediante el cual el cliente entrega un equipo como parte de pago. El equipo recibido se denomina **Trade-In Equipment**.

Todo Trade-In requiere un Customer identificado.

`PRODUCT.md` confirma al menos un equipo recibido en una venta con plan canje. La posibilidad de múltiples equipos recibidos en la misma venta es `Decision Pending`.

### 21.1. Responsabilidades

Cada equipo recibido debe:

- registrarse como una unidad individual;
- incluir los mismos datos funcionales de cualquier Equipment;
- tener un valor de toma acordado;
- ingresar al inventario;
- usar inicialmente el valor de toma como costo funcional;
- conservar la relación con la venta que originó su ingreso;
- reducir el importe restante que debe pagar el cliente.

### 21.2. Momento funcional

El ingreso del equipo recibido y la confirmación de la venta forman parte de una misma operación comercial. Un plan canje no debe reducir el saldo sin crear el equipo recibido, ni crear el equipo sin conservar la venta de origen.

El estado inicial del equipo recibido y la necesidad de revisión previa a su disponibilidad son `Decision Pending`. Como alternativa de análisis, podría ingresar `Under Review` hasta validar su condición, pero esta propuesta no está aprobada.

## 22. Invariantes de Trade-In

1. Un equipo recibido no puede ingresar dos veces por el mismo plan canje.
2. El valor de toma debe formar parte del cálculo económico de la venta.
3. El valor de toma reduce el saldo que debe pagar el cliente.
4. El equipo recibido debe conservar su relación con la venta de origen.
5. El valor de toma es el costo funcional inicial del equipo recibido.
6. Los datos del equipo recibido deben ser suficientes para administrarlo como Equipment.
7. La confirmación no debe quedar con saldo reducido si el ingreso del equipo recibido falla o resulta inválido.
8. Una venta con Trade-In solo puede cancelarse automáticamente cuando todos sus elementos continúan siendo reversibles.
9. Si el equipo recibido ya fue reservado mediante una operación dependiente, vendido, transformado o quedó en un estado incompatible, la cancelación automática debe bloquearse como `Manual Resolution Required`.
10. Una resolución manual requiere intervención autorizada y no puede borrar ni alterar operaciones posteriores para forzar la reversión.
11. Cuando todos los elementos son reversibles, la operación compensatoria puede restituir el Equipment entregado al cliente, revertir el ingreso del Trade-In Equipment y revertir los movimientos relacionados.
12. Una misma reversión no puede retirar dos veces el equipo recibido ni duplicar restituciones.

## 23. Modificación de ventas

Una venta `Draft` puede editarse libremente porque todavía no produjo efectos comerciales definitivos. Una venta `Confirmed` no puede editarse libremente como si fuera un formulario común.

### 23.1. Categorías de modificación

| Categoría | Ejemplos | Riesgo funcional |
|---|---|---|
| **Datos no operativos** | observaciones internas y notas administrativas que no alteran dinero, stock, Customer contractual o productos | Pueden modificarse con auditoría. |
| **Datos económicos** | precio final, descuento, moneda, cotización, medio de pago e importe | No pueden modificarse silenciosamente; requieren corrección, reversión o nueva operación explícita según corresponda. |
| **Datos que afectan inventario** | cambiar Equipment, cambiar cantidades, agregar o quitar productos, cambiar Trade-In | No pueden editarse directamente; requieren una operación explícita, trazable y consistente. |

### 23.2. Regla oficial

- Los datos no operativos pueden corregirse manteniendo auditoría.
- Las correcciones económicas no reescriben silenciosamente valores históricos.
- Los cambios que afectan inventario no se aplican directamente sobre una venta `Confirmed`.
- Toda corrección operativa o económica utiliza un mecanismo explícito que preserve la venta original y su trazabilidad.
- Los permisos especiales y el mecanismo concreto para cada tipo de corrección permanecen pendientes.

## 24. Cancelación y reversión

### 24.1. Distinciones conceptuales

- **Eliminar:** hacer que un concepto deje de formar parte de la información activa o histórica. Solo una venta `Draft` sin efectos comerciales puede eliminarse normalmente; una venta `Confirmed` o `Cancelled` no se elimina físicamente como comportamiento normal.
- **Cancelar:** declarar que una operación ya no debe continuar produciendo sus efectos hacia adelante, conservando que existió y por qué fue cancelada.
- **Revertir:** aplicar efectos compensatorios para restaurar coherencia sobre inventario y valores sin borrar la operación original.

Una cancelación puede requerir reversión, pero ambos conceptos no son sinónimos: la cancelación cambia la situación de la operación; la reversión explica y ejecuta sus efectos compensatorios.

### 24.2. Cancelación de Sale

Una venta `Confirmed` solo puede cancelarse mediante una operación explícita. La cancelación debe:

- cambiar el estado de `Confirmed` a `Cancelled`;
- conservar la información de la operación original;
- registrar motivo;
- registrar User responsable;
- registrar fecha;
- generar los efectos compensatorios necesarios cuando sea posible.

Una venta ya `Cancelled` no puede cancelarse nuevamente como una cancelación normal.

### 24.3. Reversibilidad

Una operación es **reversible** cuando todos sus elementos afectados todavía pueden regresar coherentemente al estado previo sin contradecir operaciones posteriores.

Pueden impedir la reversión automática:

- un Trade-In Equipment ya vendido o reservado mediante una operación dependiente;
- un Equipment restituible que participó después en otra operación;
- movimientos posteriores dependientes;
- un estado actual diferente del esperado para revertir;
- cualquier restitución que rompería una invariante.

Si la operación no es completamente reversible, su resultado es `Manual Resolution Required`. Debe intervenir un usuario autorizado; no se corrigen automáticamente estados imposibles ni se eliminan operaciones posteriores.

### 24.4. Efectos compensatorios

- **Equipment vendido:** si continúa siendo reversible, regresa al estado anterior que corresponda, normalmente `Available`. No se asume `Available` cuando una situación posterior lo impide.
- **Accesorios:** las cantidades vendidas se restituyen mediante un movimiento compensatorio.
- **Trade-In:** se revierte el ingreso solo si el equipo recibido y los movimientos relacionados siguen siendo reversibles.
- **Reserva:** la política de restauración de una reserva convertida permanece pendiente.
- **Valores económicos, pagos y seña:** sus políticas de devolución o compensación permanecen pendientes; los valores originales se conservan históricamente.

### 24.5. Idempotencia funcional

Una cancelación o reversión no puede aplicar dos veces sus efectos. Repetir la solicitud sobre una venta ya `Cancelled` no restituye nuevamente stock, no retira nuevamente un Trade-In Equipment y no duplica movimientos compensatorios.

## 25. Returns and Exchanges — Future Domain Capability

### 25.1. Decisión de alcance V1

La funcionalidad completa de devoluciones y cambios comerciales está **OUT OF SCOPE FOR V1**.

BCM SOFT V1 no implementa:

- devoluciones parciales;
- devolución posterior de Equipment;
- devolución posterior de accesorios;
- cambios de productos;
- reintegros parciales;
- políticas de plazo de devolución;
- políticas según condición del producto;
- notas de crédito;
- crédito a favor;
- devolución de dinero;
- diferencias económicas por cambio;
- flujos completos de postventa.

V1 sí contempla **Sale Cancellation / Reversal** completa conforme a las reglas de reversibilidad ya definidas. Esta operación anula la venta original; no representa una devolución comercial posterior.

### 25.2. Sale Cancellation

La operación comercial original se anula completamente. Cuando todos sus elementos continúan siendo reversibles, se aplican efectos compensatorios coherentes y la Sale pasa a `Cancelled`.

Ejemplo: una venta fue confirmada por error y se detectó antes de que existieran operaciones posteriores dependientes.

### 25.3. Return

La venta ocurrió válidamente y, posteriormente, el Customer devuelve uno o más productos. Return debe conservar relación con la venta original y no se representa editando, cancelando o eliminando destructivamente esa venta.

Return es una **Future Domain Capability** y no forma parte de BCM SOFT V1.

### 25.4. Exchange

La venta ocurrió válidamente y, posteriormente, el Customer entrega un producto y recibe otro. Conceptualmente implicará una restitución, una nueva salida, una posible diferencia económica y trazabilidad hacia la venta original.

Exchange es una **Future Domain Capability** y no forma parte de BCM SOFT V1.

### 25.5. Definiciones futuras pendientes

Antes de implementar Return o Exchange deberán definirse sus estados, reglas completas, cálculos económicos, políticas, reintegros, plazos, permisos, condición de los productos, impacto sobre inventario, moneda, cotización, rentabilidad e interacción con garantías.

Este documento conserva los conceptos para evolución futura sin tomar esas decisiones ahora.

## 26. Inventory Movement

Un **Inventory Movement** explica por qué cambió la cantidad, el estado o la disponibilidad del inventario.

### 26.1. Causas conceptuales

- ingreso manual;
- confirmación de venta;
- reversión válida;
- ingreso por plan canje;
- reserva y liberación de equipo;
- envío a revisión y finalización de revisión;
- ajuste autorizado;
- futura compra;
- futura devolución;
- archivo o recuperación, si se definen sus reglas.

### 26.2. Reglas

1. Todo cambio relevante de inventario debe tener una causa.
2. El movimiento debe permitir relacionar el cambio con su operación de origen cuando exista.
3. Un movimiento no debe borrar ni reemplazar la explicación de movimientos anteriores.
4. Las reversiones generan explicaciones compensatorias; no vuelven inexistente el movimiento original.
5. Un ajuste manual es una operación explícita y debe registrar como mínimo motivo, User responsable y fecha.
6. Reserva y revisión cambian disponibilidad o estado, aunque no necesariamente la presencia física del equipo.

Los permisos concretos y la evidencia adicional requerida para ajustes manuales permanecen como `Decision Pending`. Modificar silenciosamente el valor actual de stock no es un mecanismo normal de corrección.

El concepto debe permitir responder: **¿por qué cambió este stock o esta disponibilidad?**

## 27. Audit Event

Un **Audit Event** proporciona trazabilidad funcional sobre acciones sensibles. Debe permitir responder, cuando corresponda:

- quién realizó la acción;
- qué acción realizó;
- cuándo ocurrió;
- sobre qué concepto u operación;
- cuál fue el motivo u origen;
- qué relación tiene con una operación previa.

### 27.1. Acciones candidatas

- confirmación, cancelación o reversión de venta;
- cambio de estado de un equipo;
- creación, conversión o cancelación de reserva;
- ajustes de stock;
- ingreso de equipo por plan canje;
- cambios de costo, precio o cotización;
- cambios de catálogos utilizados comercialmente;
- acciones administrativas sensibles.

### 27.2. Distinción

La auditoría de negocio explica acciones significativas para la operación y la responsabilidad de los usuarios. No equivale a registros técnicos de funcionamiento. El alcance obligatorio, los motivos requeridos, la visibilidad y la conservación son `Decision Pending`.

## 28. Catálogos configurables

Un **Catalog** reúne valores comerciales reutilizables que el negocio puede administrar, incluidos:

- categorías;
- marcas;
- modelos;
- capacidades;
- colores;
- condiciones estéticas;
- condiciones funcionales;
- medios de pago;
- tipos de producto;
- otros valores necesarios.

### 28.1. Reglas históricas

1. Cambiar el nombre o la situación actual de un valor de catálogo no debe reescribir la interpretación de una operación histórica.
2. Desactivar un valor puede impedir su selección futura, pero no debe romper referencias históricas.
3. Eliminar un valor que ya fue utilizado no debe destruir el significado de equipos u operaciones anteriores.
4. La diferencia exacta entre editar, desactivar, reemplazar y eliminar es `Decision Pending`.
5. Las dependencias entre catálogos, por ejemplo marca y modelo, son `Decision Pending`.

La cotización de referencia es una configuración comercial, pero cada operación debe conservar su propia cotización histórica cuando corresponda.

## 29. Flujos principales

### Flujo A — Ingreso manual de Equipment

**Precondiciones**

- El usuario actúa dentro de un negocio.
- Dispone de los datos funcionales mínimos del equipo; cuáles son obligatorios es `Decision Pending`.
- El equipo no debe representar un ingreso duplicado conocido.

**Acción**

1. El usuario registra identidad, características, condición, costo, precio, observaciones, fotos y origen disponibles.
2. Indica el estado inicial permitido.
3. Confirma el ingreso.

**Efectos**

- Se reconoce una nueva unidad individual en el inventario.
- Se explica el ingreso mediante su origen.
- El equipo adquiere la disponibilidad correspondiente a su estado.

**Postcondiciones**

- El equipo pertenece al negocio.
- Puede rastrearse por su identidad funcional.
- Si queda `Available`, puede participar en una venta o reserva.

**Errores posibles**

- IMEI potencialmente duplicado;
- datos mínimos incompletos;
- costo o cotización inválidos;
- catálogo no permitido o desactivado;
- estado inicial no autorizado.

### Flujo B — Ingreso o ajuste de accesorios

**Precondiciones**

- Existe el producto accesorio o se dispone de sus datos para registrarlo.
- La cantidad del ingreso o ajuste es válida.
- El usuario posee autorización funcional, todavía pendiente de detalle.

**Acción**

1. Se identifica el producto y la causa del cambio.
2. Se registra la cantidad y, cuando corresponda, costo y origen.
3. Se confirma el movimiento.

**Efectos**

- Cambia la cantidad disponible según la causa.
- Queda una explicación funcional del cambio.

**Postcondiciones**

- El stock no es negativo.
- La nueva cantidad coincide con el movimiento realizado.

**Errores posibles**

- cantidad cero o no válida;
- ajuste que produciría stock negativo;
- SKU potencialmente duplicado;
- causa ausente;
- costo o cotización inválidos.

### Flujo C — Venta de Equipment

**Precondiciones**

- El equipo pertenece al negocio y está `Available`.
- No forma parte de otra venta confirmada.
- Los valores económicos requeridos son válidos.
- El Customer puede omitirse en una venta estándar.

**Acción**

1. Se selecciona el equipo.
2. Se asocia o crea el cliente cuando corresponda.
3. Se registran precio final, moneda, cotización, medio de pago y observaciones.
4. Se confirma la venta.

**Efectos**

- El equipo pasa a `Sold`.
- Se conserva el precio final, costo histórico y contexto monetario.
- La venta se relaciona con el cliente cuando existe.
- Se explica la salida del inventario.

**Postcondiciones**

- El equipo no está disponible para otra venta o reserva.
- La venta puede explicar la salida de la unidad.

**Errores posibles**

- equipo `Sold`, `Reserved`, `Under Review` o `Archived`;
- disponibilidad modificada por otra operación;
- cotización requerida ausente o inválida;
- precio inválido según reglas pendientes.

### Flujo D — Venta de Equipment y accesorios

**Precondiciones**

- Cada equipo está habilitado para venta.
- Existe cantidad suficiente de cada accesorio.
- Todos los conceptos pertenecen al mismo negocio.

**Acción**

1. Se seleccionan uno o más equipos y cantidades de accesorios.
2. Se registran cliente, precios, descuentos o regalos, moneda, cotización y medio de pago.
3. Se confirma el conjunto como una venta.

**Efectos**

- Los equipos pasan a `Sold`.
- Se descuentan las cantidades de accesorios.
- Se conservan valores históricos por ítem y por operación cuando corresponda.

**Postcondiciones**

- Ningún equipo vendido queda disponible.
- Ningún stock queda negativo.
- Todos los efectos se explican por la misma venta.

**Errores posibles**

- cualquiera de los errores del flujo C;
- stock insuficiente en al menos un accesorio;
- cantidad no válida;
- duplicación del mismo equipo;
- falla de una parte que impediría confirmar coherentemente el conjunto.

### Flujo E — Venta con plan canje

**Precondiciones**

- La venta cumple sus precondiciones ordinarias.
- Existe un Customer identificado que entrega al menos un equipo identificable.
- Se acuerda un valor de toma válido.
- El equipo recibido no está ya registrado como el mismo ingreso.

**Acción**

1. Se registran los productos vendidos.
2. Se registran los datos del equipo recibido y su valor de toma.
3. El valor reduce el saldo a pagar.
4. Se confirma la venta junto con el ingreso del equipo.

**Efectos**

- Se producen las salidas de inventario de la venta.
- El equipo recibido ingresa con el valor de toma como costo inicial.
- La venta y el equipo recibido quedan relacionados.

**Postcondiciones**

- El saldo refleja el valor de toma.
- El ingreso no está duplicado.
- La operación permite explicar tanto la salida como el ingreso.

**Errores posibles**

- datos insuficientes del equipo recibido;
- IMEI potencialmente duplicado;
- valor de toma inválido;
- intento de registrar dos veces el mismo equipo;
- imposibilidad de completar coherentemente venta e ingreso.

### Flujo F — Crear reserva

**Precondiciones**

- El equipo está `Available`.
- Existe un cliente.
- No existe otra reserva activa sobre la unidad.

**Acción**

1. Se seleccionan equipo y cliente.
2. Se registran fecha, seña y observaciones.
3. Se activa la reserva.

**Efectos**

- El equipo pasa a `Reserved`.
- Queda temporalmente asignado al cliente.

**Postcondiciones**

- El equipo no aparece disponible para otra operación.
- La reserva y la causa del estado pueden identificarse.

**Errores posibles**

- equipo no disponible;
- otra reserva activa;
- cliente ausente;
- seña o moneda inválida según reglas pendientes;
- conflicto con otra operación que vendió o reservó la unidad.

### Flujo G — Cancelar reserva

**Precondiciones**

- La reserva está activa.
- No fue convertida en venta.
- El usuario puede cancelarla conforme a permisos pendientes.

**Acción**

1. Se identifica la reserva y el motivo.
2. Se aplica la política de seña todavía pendiente.
3. Se confirma la cancelación.

**Efectos**

- La reserva deja de estar activa.
- El equipo recupera el estado que corresponda, normalmente `Available` si nada más lo impide.
- Se conserva la historia de la reserva.

**Postcondiciones**

- El equipo no queda simultáneamente reservado y disponible.
- La cancelación y su efecto son explicables.

**Errores posibles**

- reserva ya cancelada, convertida o expirada;
- situación actual del equipo incompatible con liberarlo;
- política de seña no definida;
- falta de autorización o motivo cuando se requiera.

### Flujo H — Convertir reserva en venta

**Precondiciones**

- La reserva está activa.
- El equipo continúa relacionado con esa reserva y está `Reserved`.
- Se cumplen las condiciones económicas de una venta.
- El Customer de la venta es el mismo Customer asociado a la reserva.

**Acción**

1. Se inicia la venta desde la reserva.
2. Se completan productos adicionales, precios, pago y contexto monetario.
3. Se aplica la seña según política pendiente.
4. Se confirma la venta.

**Efectos**

- El equipo pasa de `Reserved` a `Sold`.
- La reserva queda convertida y relacionada con la venta.
- Los demás productos producen sus efectos normales.

**Postcondiciones**

- No quedan una reserva activa y una venta confirmada sobre la misma unidad.
- La relación reserva–venta permanece trazable.

**Errores posibles**

- reserva no activa;
- equipo liberado, vendido o cambiado de estado;
- Customer de la venta diferente del Customer de la reserva;
- tratamiento de seña no resoluble;
- stock insuficiente de productos adicionales.

### Flujo I — Crear cliente durante una venta

**Precondiciones**

- Existe una venta en preparación.
- No se encontró un cliente existente adecuado.
- Se dispone de la identidad mínima requerida, aún pendiente de detalle.

**Acción**

1. Sin abandonar la venta, se registran los datos básicos del cliente.
2. Se confirma la creación del cliente.
3. Se asocia el nuevo cliente a la venta en preparación.

**Efectos**

- El cliente queda disponible en el registro centralizado del negocio.
- La venta continúa con ese cliente asociado.

**Postcondiciones**

- No se duplicó intencionalmente un cliente conocido.
- La venta conserva el cliente seleccionado al confirmarse.

**Errores posibles**

- datos mínimos incompletos;
- posible duplicado de cliente;
- información perteneciente a otro negocio;
- creación cancelada, en cuyo caso la venta continúa sin asociación hasta resolverla.

## 30. Casos límite y errores esperables

| Caso | Tratamiento de dominio vigente |
|---|---|
| Intentar vender Equipment `Sold` | Rechazar la venta normal. Solo una reversión válida podría cambiar su situación. |
| Intentar vender Equipment `Reserved` | Rechazar el flujo normal; solo puede avanzar mediante una conversión válida o una liberación previa conforme a reglas pendientes. |
| Vender más accesorios que el stock disponible | Rechazar la confirmación completa; el stock no puede quedar negativo. |
| Registrar IMEI duplicado | Rechazar dentro del mismo negocio. Una corrección de datos histórica requerirá una futura política explícita. |
| Cancelar una reserva ya convertida | Rechazar la cancelación como reserva activa; cualquier cambio debe tratar la venta relacionada. |
| Vender mientras otra operación intenta reservar | Solo una operación puede producir un resultado válido; la otra debe recibir un conflicto de disponibilidad sin efectos parciales. |
| Cancelar una venta con Trade-In | Revertir automáticamente solo si todos sus elementos siguen siendo reversibles; en caso contrario, `Manual Resolution Required`. |
| Modificar el precio después de confirmar la venta | No cambiar silenciosamente el valor histórico; utilizar una corrección, reversión o nueva operación explícita según corresponda. |
| Cambiar la cotización general | Permitido para operaciones futuras; no altera operaciones históricas. |
| Eliminar un catálogo utilizado históricamente | No debe destruir la interpretación histórica; desactivación, reemplazo o eliminación son `Decision Pending`. |
| Eliminar o desactivar un cliente con ventas históricas | No debe romper la trazabilidad. Las políticas de desactivación, anonimización o eliminación son `Decision Pending`. |
| Intentar vender un producto archivado | No tratarlo como disponible. Su recuperación o transición es `Decision Pending`. |
| Accesorio con precio final cero | Permitido como regalo; descuenta stock y conserva costo histórico. |
| Equipment con precio final cero | `Decision Pending`; la excepción definida en producto se refiere a accesorios. |
| Producto con costo cero | `Decision Pending`: debe distinguirse costo genuinamente cero de costo desconocido o incompleto. |
| Confirmar venta sin cliente | Permitido para una venta estándar; rechazado para Reservation o Trade-In, que requieren Customer identificado. |
| Confirmar venta sin productos | `Decision Pending`: se propone rechazarla porque no representa una entrega comercial, pero la regla requiere aprobación. |
| Cotización cero o negativa | Rechazar cuando la operación requiere cotización; no tiene interpretación económica válida. |
| Repetir la confirmación de la misma venta | No debe duplicar salidas, ingresos de Trade-In ni efectos económicos. Una venta ya `Confirmed` no vuelve a confirmarse normalmente. |
| Cancelar dos veces la misma operación | No debe duplicar restituciones ni efectos compensatorios. |
| Revertir accesorios después de cambios posteriores de stock | Restituir solo la cantidad correspondiente a la operación, sin reescribir otros movimientos. La condición física devuelta es `Decision Pending`. |
| Revertir una venta cuyo Equipment ya cambió de situación | No devolverlo automáticamente a `Available`; requiere una regla compatible con su estado actual. |
| Revertir una venta con operaciones posteriores dependientes | Bloquear la reversión automática y marcar `Manual Resolution Required`; no alterar las operaciones posteriores. |
| Recibir por Trade-In un Equipment ya registrado | Rechazar el ingreso duplicado o exigir resolución explícita de identidad. |
| Valor de toma mayor que el total vendido | `Decision Pending`: definir si genera saldo a favor, pago al cliente o invalida la operación. |
| Reserva con seña cero | `Decision Pending`: no está definido si la seña es obligatoria ni su monto mínimo. |
| Reserva vencida durante una venta | `Decision Pending`: se requiere una regla de expiración y resolución de conflictos. |
| Catálogo desactivado en un borrador o reserva activa | `Decision Pending`: preservar historia sin permitir nuevas selecciones no resuelve operaciones todavía no confirmadas. |
| Cambio de datos actuales del cliente | Permitido sin reescribir la relación ni el contexto histórico de operaciones previas. El detalle histórico conservado está pendiente. |

### 30.1. Principio general de error

Un error funcional debe impedir que una operación deje efectos parciales o contradiga invariantes. El rechazo debe expresar la causa de negocio relevante, como falta de disponibilidad, stock insuficiente, estado incompatible, valor inválido o conflicto con otra operación.

## 31. Global Domain Invariants

Estas reglas no deben romperse en ningún flujo válido:

1. El stock de accesorios no puede ser negativo.
2. Un Equipment no puede estar simultáneamente `Available` y `Sold`.
3. Un Equipment no puede formar parte de dos ventas `Confirmed` simultáneamente.
4. Un Equipment no puede tener dos Reservation `Active` simultáneamente.
5. Una Sale `Confirmed` o `Cancelled` no se elimina físicamente como operación normal.
6. Toda cancelación conserva trazabilidad, incluida la venta original, motivo, User responsable y fecha.
7. Una cancelación o reversión no puede aplicar dos veces sus efectos.
8. Una reversión solo puede ejecutarse automáticamente si todos sus elementos continúan siendo reversibles.
9. Un Trade-In Equipment conserva su origen y relación con la Sale de origen.
10. Un Trade-In Equipment vendido o afectado por una operación posterior bloquea la reversión automática de la venta de origen.
11. Los valores económicos históricos son inmutables frente a precios, costos, cotizaciones y configuraciones actuales.
12. Cada Equipment utiliza Specific Historical Cost propio; no se promedia con unidades similares.
13. Cada Accessory Product utiliza Moving Weighted Average Cost en V1.
14. Un accesorio gratuito conserva costo histórico, disminuye stock y afecta negativamente Gross Profit USD.
15. Customer es obligatorio para Reservation y Trade-In.
16. El IMEI, cuando existe, es único dentro del mismo Organization / Business.
17. La cotización utilizada por una operación económica es histórica y no cambia con la cotización general.
18. Todo ajuste manual de inventario requiere como mínimo causa, User responsable y fecha.
19. Los datos de distintos negocios permanecen funcionalmente independientes y no se combinan en una operación.
20. Consistencia, trazabilidad y corrección económica prevalecen sobre la edición destructiva o la comodidad operativa.
21. Una Reservation `Active` impide tratar el Equipment como disponible para otro cliente.
22. Un Equipment reservado solo se vende mediante conversión al mismo Customer; para venderlo a otro debe liberarse antes mediante cancelación válida.
23. Una Sale `Confirmed` no puede editarse libremente ni reescribir silenciosamente datos económicos o de inventario.
24. El valor de Trade-In forma parte de la contraprestación de la venta y no se contabiliza dos veces en Gross Profit USD.
25. Una Sale `Confirmed` no puede quedar con solo una parte de sus efectos funcionales aplicada.
26. Los movimientos de inventario son explicables por una operación, ajuste u origen reconocido.
27. Un cambio de estado de Equipment debe tener una causa válida y trazable.
28. Desactivar un cliente, proveedor o catálogo no rompe relaciones históricas existentes.
29. Una Sale Cancellation y un Return representan eventos comerciales distintos.
30. BCM SOFT V1 no permite representar un Return mediante la modificación destructiva de una Sale `Confirmed`.

Ante un conflicto de objetivos, el dominio prioriza en este orden: **consistencia**, **trazabilidad**, **corrección económica** y, finalmente, **comodidad operativa**.

## 32. Eventos de dominio conceptuales

Los siguientes nombres representan hechos relevantes que ocurrieron en el negocio. No determinan cómo se comunican o almacenan técnicamente.

| Evento conceptual | Significado de negocio | Efectos relacionados |
|---|---|---|
| **EquipmentAdded** | Una nueva unidad fue reconocida en el inventario. | Establece origen, costo inicial, estado y disponibilidad. |
| **EquipmentSentToReview** | Un equipo disponible fue apartado para revisión. | Cambia de `Available` a `Under Review`. |
| **EquipmentReviewCompleted** | Finalizó la revisión de un equipo. | Puede habilitar `Under Review → Available`; otros resultados son pendientes. |
| **EquipmentReserved** | Se activó una reserva sobre un equipo. | Relaciona equipo y cliente; cambia a `Reserved`. |
| **ReservationCancelled** | Una reserva activa fue cancelada. | Finaliza la reserva y libera el equipo cuando corresponde. |
| **ReservationConvertedToSale** | Una reserva originó una venta confirmada. | Relaciona ambas operaciones y cambia el equipo a `Sold`. |
| **SaleConfirmed** | Una venta fue confirmada coherentemente. | Produce salidas, ingresos de Trade-In y valores históricos. |
| **SaleCancelled** | Una venta confirmada fue cancelada explícitamente. | Conserva la venta, registra motivo, User y fecha, y se relaciona con sus efectos compensatorios. |
| **SaleReversed** | Se aplicaron efectos compensatorios sobre una venta reversible. | Restituye coherencia sin borrar la operación original ni duplicar efectos. |
| **AccessoryStockChanged** | Cambió la cantidad de un producto accesorio. | Conserva causa, cantidad y relación con la operación de origen. |
| **InventoryAdjusted** | Un usuario realizó un ajuste manual explícito. | Conserva motivo, User responsable, fecha y cambio producido. |
| **TradeInReceived** | Un equipo fue recibido como parte de pago. | Ingresa al inventario con valor de toma y relación con la venta. |
| **CatalogValueChanged** | Cambió o se desactivó un valor configurable. | Afecta uso futuro sin reescribir historia. |
| **ExchangeRateChanged** | Cambió la cotización general de referencia. | Afecta operaciones futuras; no modifica cotizaciones históricas. |

Los eventos de devolución continúan como conceptos de una capacidad futura. Todos estos eventos son hechos de negocio y no definen mecanismos técnicos.

## 33. Registro de decisiones de dominio

| ID | Tema | Estado | Decisión o pregunta vigente | Prioridad | Fase sugerida |
|---|---|---|---|---|---|
| `DOM-DEC-001` | Modificación de venta | `Resolved` | `Draft` se edita libremente. En `Confirmed`, solo datos no operativos se corrigen con auditoría; cambios económicos o de inventario requieren operación explícita. | Critical | BCM-002A |
| `DOM-DEC-002` | Cancelación de venta | `Resolved` | `Confirmed → Cancelled` mediante cancelación explícita, trazable e idempotente; conserva original y aplica efectos compensatorios cuando es reversible. | Critical | BCM-002A |
| `DOM-DEC-003` | Devoluciones y cambios conceptuales | `Resolved` | Son operaciones posteriores vinculadas a la venta original, nunca una edición o eliminación de la venta. La capacidad completa queda fuera de V1. | Critical | BCM-002A |
| `DOM-DEC-004` | Reversión de Trade-In | `Resolved` | Solo es automática si todos los elementos siguen siendo reversibles; de lo contrario queda `Manual Resolution Required` sin alterar operaciones posteriores. | Critical | BCM-002A |
| `DOM-DEC-005` | Venta de reservado | `Resolved` | Solo mediante `Reservation → ConvertedToSale` al mismo Customer. Para otro comprador se requiere cancelación o liberación previa válida. | High | BCM-002A |
| `DOM-DEC-006` | Señas | `Pending` | ¿Cómo se aplican, devuelven o pierden las señas y qué reglas dependen de quién cancela? | High | Seguimiento de producto/dominio |
| `DOM-DEC-007` | Vencimiento de reservas | `Pending` | ¿Las reservas vencen, cuándo y con qué efecto sobre Equipment y seña? | High | Seguimiento de producto/dominio |
| `DOM-DEC-008` | Stock reservado de accesorios | `Pending` | ¿V1 necesita apartar cantidades de accesorios antes de una venta? | Medium | Roadmap funcional posterior |
| `DOM-DEC-009` | Venta sin cliente | `Resolved` | Customer es opcional en venta estándar y obligatorio para Reservation y Trade-In. | High | BCM-002A |
| `DOM-DEC-010` | Ciclo de Sale | `Resolved` | Se adoptan `Draft`, `Confirmed` y `Cancelled`; solo Draft sin efectos puede eliminarse normalmente. | High | BCM-002A |
| `DOM-DEC-011` | Múltiples equipos vendidos | `Pending` | Aunque se permite uno o más, ¿existen límites o restricciones de combinación por venta? | Low | Roadmap funcional posterior |
| `DOM-DEC-012` | Múltiples Trade-Ins | `Pending` | ¿Una venta puede recibir más de un equipo y cómo se distribuyen sus valores de toma? | High | Seguimiento de producto/dominio |
| `DOM-DEC-013` | Rentabilidad base V1 | `Resolved` | Se adopta Gross Profit USD: ingresos reconocidos en USD menos costo histórico de productos entregados en USD, sin doble contabilizar Trade-In. | Critical | BCM-002A |
| `DOM-DEC-014` | Redondeos y precisión | `Pending` | ¿Qué precisión y redondeo se aplican a importes, cotizaciones y rentabilidad? | High | Antes de BCM-004 |
| `DOM-DEC-015` | Cotización histórica | `Resolved` | Cada operación conserva la cotización usada; la cotización general es solo un valor predeterminado para operaciones nuevas. | High | BCM-002A |
| `DOM-DEC-016` | Sucursales | `Pending` | ¿Existirán sucursales y cómo funcionarán propiedad, disponibilidad y transferencias de stock? | High | Roadmap funcional futuro |
| `DOM-DEC-017` | Compras | `Pending` | ¿Cómo se registran compras a proveedores, ingresos, costos, monedas y devoluciones? | High | Roadmap funcional futuro |
| `DOM-DEC-018` | Garantías | `Pending` | ¿Qué alcance, plazos, estados y efectos de inventario tendrán las garantías? | Medium | Roadmap funcional futuro |
| `DOM-DEC-019` | Financiamiento | `Pending` | ¿Qué modalidades de financiación y relación con clientes y pagos se admitirán? | Medium | Roadmap funcional futuro |
| `DOM-DEC-020` | Caja | `Pending` | ¿Cómo se registran ingresos, egresos, cierres y diferencias por medio de pago? | High | Roadmap funcional futuro |
| `DOM-DEC-021` | Unicidad de IMEI | `Resolved` | Cuando existe, el IMEI es único dentro del mismo negocio; excepciones requieren una futura política explícita de corrección. | High | BCM-002A |
| `DOM-DEC-022` | Archived | `Pending` | ¿Qué causas permiten archivar Equipment o accesorios y qué transiciones de recuperación existen? | Medium | Seguimiento de dominio |
| `DOM-DEC-023` | Catálogos históricos | `Pending` | ¿Qué se permite editar, desactivar o eliminar cuando un valor ya fue utilizado? | High | Antes de BCM-004 |
| `DOM-DEC-024` | Clientes históricos | `Pending` | ¿Cómo funcionan desactivación, eliminación o anonimización sin perder trazabilidad? | High | BCM-005 |
| `DOM-DEC-025` | Pagos | `Pending` | ¿Una venta admite pagos múltiples, combinados, parciales, cuotas o referencias externas? | High | Seguimiento de producto/dominio |
| `DOM-DEC-026` | Costo de accesorios | `Resolved` | V1 utiliza Moving Weighted Average Cost; cada venta conserva el promedio aplicado al confirmarse. | Critical | BCM-002A |
| `DOM-DEC-027` | Costo cero | `Pending` | ¿Costo cero es válido y cómo se diferencia de costo desconocido? | High | Seguimiento de dominio |
| `DOM-DEC-028` | Impuestos | `Pending` | ¿Qué impuestos afectan precios, ventas, comprobantes y métricas futuras? | High | Roadmap funcional futuro |
| `DOM-DEC-029` | Comprobantes | `Pending` | ¿Qué comprobantes comerciales se requieren y cuándo se emiten? | Medium | Roadmap funcional futuro |
| `DOM-DEC-030` | Descuentos y promociones | `Pending` | ¿Qué tipos existen, dónde se aplican y quién puede autorizarlos? | Medium | Seguimiento de producto/dominio |
| `DOM-DEC-031` | Bajo stock | `Pending` | ¿Cómo se define el umbral de bajo stock por accesorio? | Low | Seguimiento de producto |
| `DOM-DEC-032` | Dashboard | `Pending` | ¿Qué períodos y criterios exactos usan facturación, Gross Profit USD y operaciones recientes? | Medium | Antes de implementar dashboard |
| `DOM-DEC-033` | Auditoría | `Pending` | Además de cancelaciones y ajustes, ¿qué acciones, datos, motivos y plazos de conservación son obligatorios? | High | BCM-005 y estándares posteriores |
| `DOM-DEC-034` | Usuarios y permisos | `Pending` | ¿Qué puede consultar o modificar cada tipo de usuario y qué operaciones requieren autorización especial? | High | BCM-005 |
| `DOM-DEC-035` | Independencia de negocios | `Pending` | ¿Qué reglas funcionales adicionales rigen usuarios que accedan a más de un negocio? | High | BCM-005 |
| `DOM-DEC-036` | Lista de precios | `Pending` | ¿Qué formatos, campos y reglas de precios personalizados se necesitan al exportar o compartir? | Low | Seguimiento de producto |
| `DOM-DEC-037` | Estados de Equipment | `Pending` | ¿Qué transiciones involucran `Archived` y cuáles son los resultados posibles de `Under Review`? | High | Antes de BCM-003 |
| `DOM-DEC-038` | Modificar reservas | `Pending` | ¿Pueden extenderse, cambiar de Customer, cambiar de Equipment o modificar la seña? | Medium | Seguimiento de producto/dominio |
| `DOM-DEC-039` | Ajustes de inventario | `Pending` | Además de motivo, User y fecha obligatorios, ¿qué permisos y evidencia se requieren? | High | Seguimiento de dominio y seguridad |
| `DOM-DEC-040` | Ingreso manual | `Pending` | ¿Qué datos, origen, costo y estado inicial son obligatorios al crear Equipment o accesorios? | High | Antes de BCM-004 |
| `DOM-DEC-041` | Trade-In recibido | `Pending` | ¿El Equipment recibido ingresa `Under Review` o `Available`, y quién valida su condición? | High | Antes de BCM-003 |
| `DOM-DEC-042` | Saldo negativo por Trade-In | `Pending` | ¿Qué ocurre cuando el valor de toma supera el total de la venta? | High | Seguimiento de producto/dominio |
| `DOM-DEC-043` | Venta vacía | `Pending` | ¿Debe rechazarse siempre una venta sin productos o existen operaciones económicas sin entrega? | High | Antes de BCM-003 |
| `DOM-DEC-044` | Datos históricos del cliente | `Pending` | ¿Qué identidad y contacto deben conservarse tal como estaban al confirmar una operación? | Medium | Seguimiento de dominio y seguridad |
| `DOM-DEC-045` | Precio cero de Equipment | `Pending` | ¿Puede venderse un Equipment con precio final cero y bajo qué autorización? | Medium | Seguimiento de producto/dominio |
| `DOM-DEC-046` | Estados de accesorios | `Pending` | ¿Qué estados puede tener Accessory Product y cuáles permiten vender o ajustar stock? | High | Antes de BCM-003 |
| `DOM-DEC-047` | Alcance de devoluciones V1 | `Resolved` | Return y Exchange completos quedan fuera de V1. V1 solo contempla Sale Cancellation / Reversal completa según las reglas vigentes de reversibilidad. | Critical | BCM-002B |
| `DOM-DEC-048` | Cambios comerciales completos | `Pending — Future Capability` | ¿Cómo se calculan y autorizan restitución, nueva salida y diferencia económica en un Exchange? | High | Roadmap funcional futuro |
| `DOM-DEC-049` | Costos de Trade-In | `Pending` | ¿Cómo afectan reparación, reacondicionamiento y otros costos posteriores al costo del Equipment recibido? | High | Seguimiento de producto/dominio |
| `DOM-DEC-050` | Costo de Equipment | `Resolved` | V1 utiliza Specific Historical Cost por unidad; no se promedian equipos aunque sean del mismo modelo. | Critical | BCM-002A |
| `DOM-DEC-051` | Configuración de cotización | `Pending` | ¿Qué convención, tipo de dólar, fuente y permisos de actualización usa la cotización sugerida? | High | Seguimiento de producto/dominio |
| `DOM-DEC-052` | Métricas extendidas de rentabilidad | `Pending` | ¿Cuándo se incorporan comisiones, impuestos, gastos operativos, costos financieros y otras métricas distintas de Gross Profit USD? | Medium | Roadmap funcional futuro |
| `DOM-DEC-053` | Reserva tras cancelar venta | `Pending` | Si una venta originada en Reservation se cancela, ¿se restaura la reserva, se crea otra o queda convertida históricamente? | High | Seguimiento de producto/dominio |
| `DOM-DEC-054` | Resolución manual | `Pending` | ¿Quién puede resolver una operación no reversible, qué acciones compensatorias se permiten y qué evidencia debe registrarse? | High | Seguimiento de dominio y seguridad |
| `DOM-DEC-055` | Diseño futuro de Return | `Pending — Future Capability` | ¿Qué estados, plazos, condiciones, reintegros, movimientos de inventario y reglas económicas tendrá Return antes de su futura implementación? | High | Roadmap funcional futuro |

Las decisiones `Resolved` son reglas oficiales del dominio. Las decisiones `Pending` no autorizan comportamientos y deben resolverse en la fase indicada antes de implementar la capacidad afectada.

## 34. No diseñar todavía

Este documento se limita al modelo funcional del negocio. Deliberadamente no define:

- estructuras de almacenamiento o diseño de base de datos;
- formatos de tablas, campos, índices o migraciones;
- contratos de API, endpoints o controladores;
- componentes, repositorios o servicios de software;
- frameworks o dependencias;
- infraestructura, despliegue o servicios cloud;
- mecanismos técnicos de aislamiento, atomicidad, auditoría o eventos.

Esas decisiones pertenecen a fases posteriores y deben partir de las reglas y decisiones de dominio aquí documentadas.
