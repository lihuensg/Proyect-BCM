# BCM SOFT — Definición del producto

**Estado:** Completed  
**Fase:** BCM-001 — Product Definition
**Última actualización:** BCM-012A — Customer Business Decisions Reconciliation

Este documento es la fuente principal de la definición funcional y de negocio de BCM SOFT. Describe el producto y su alcance inicial sin establecer decisiones técnicas, arquitectónicas ni de implementación.

## 1. Identidad del producto

**BCM SOFT** es una plataforma de gestión comercial para negocios dedicados a la compra y venta de celulares, tablets, notebooks, smartwatches, accesorios y otros productos tecnológicos.

BCM SOFT es el producto reutilizable. **BCM** es el primer negocio que utilizará el producto. Ambos conceptos son distintos: las necesidades iniciales de BCM orientan la primera versión, pero no limitan el producto a un único negocio.

## 2. Visión

Centralizar la operación diaria de comercios tecnológicos en una plataforma que conecte inventario, ventas, clientes, reservas, proveedores, precios y resultados del negocio.

La primera versión debe ser productiva y estable para el uso real de BCM. A futuro, BCM SOFT debe poder ser utilizado por otros negocios similares manteniendo independiente la información de cada uno.

## 3. Problema que resuelve

Los comercios de productos tecnológicos necesitan controlar unidades con identidad propia y accesorios administrados por cantidad, registrar operaciones en distintas monedas y mantener coordinados procesos que afectan el stock y los resultados financieros.

BCM SOFT busca resolver principalmente:

- la dispersión de información comercial;
- la duplicación de carga entre operaciones relacionadas;
- la falta de trazabilidad sobre equipos, ventas, reservas y planes canje;
- las inconsistencias entre ventas e inventario;
- la pérdida del contexto histórico de cotizaciones, costos y precios;
- la dificultad para consultar disponibilidad, actividad y rentabilidad del negocio.

## 4. Mercado inicial

El mercado inicial está compuesto por comercios que compran y venden celulares, tablets, notebooks, smartwatches, accesorios y otros productos tecnológicos.

Estos negocios pueden trabajar con productos nuevos o usados, equipos individualizados y artículos controlados por cantidad, además de operar con dólares estadounidenses y pesos argentinos.

## 5. Primer cliente

BCM será el primer negocio en utilizar BCM SOFT. BCM se dedica a la venta de celulares y productos tecnológicos, y su operación diaria será el contexto inicial para validar la primera versión productiva.

La experiencia de BCM servirá para evaluar el producto sin convertir sus particularidades en supuestos universales para todos los negocios futuros.

## 6. Tipos de usuario

Un negocio podrá tener múltiples usuarios. Los tipos funcionales iniciales contemplados son:

- dueño, con necesidad de visión general del negocio;
- administrador, responsable de la gestión operativa y las configuraciones;
- vendedor, enfocado en clientes, disponibilidad, reservas y ventas;
- usuario de consulta, con acceso de solo consulta según los permisos que se definan.

La definición detallada de usuarios, permisos, organizaciones y aislamiento de información queda para fases posteriores.

## 7. Objetivos

Los objetivos funcionales iniciales son:

1. Centralizar la información necesaria para operar el negocio.
2. Conocer la disponibilidad real de equipos y accesorios.
3. Registrar ventas y reflejar sus efectos en el inventario.
4. Mantener el historial comercial y financiero de las operaciones.
5. Gestionar clientes, reservas, proveedores y planes canje de manera relacionada.
6. Analizar resultados en USD y ARS sin alterar valores históricos.
7. Permitir que los catálogos comerciales habituales sean configurables.
8. Brindar una visión resumida y actual del negocio.
9. Validar una primera versión estable mediante el uso cotidiano de BCM.
10. Sentar una definición funcional reutilizable para negocios similares.
11. Registrar gastos y distinguir ingresos, costo de mercadería, ganancia bruta y resultado del negocio.
12. Ofrecer un dashboard V1 medible con resultados en ARS/USD y filtros temporales útiles.

## 8. Alcance de BCM SOFT V1

La primera versión productiva incluye:

- autenticación básica;
- negocio u organización;
- usuarios y permisos básicos;
- configuraciones y catálogos;
- inventario de equipos;
- inventario de accesorios;
- clientes;
- proveedores básicos;
- ventas;
- plan canje;
- reservas;
- lista de precios;
- gastos del negocio;
- dashboard prioritario para la gestión diaria;
- garantías básicas diferenciadas de cliente y proveedor;
- capacidad de ventas financiadas limitada por una decisión V1 previa;
- auditoría funcional de operaciones relevantes.

El alcance V1 prioriza una operación estable y utilizable por BCM por encima de incorporar una mayor cantidad de funcionalidades.

## 9. Módulos

### 9.1. Inventario de equipos

Administra productos identificables individualmente, como celulares, tablets, MacBook, notebooks, smartwatches y otros equipos equivalentes.

La información funcional principal de un equipo comprende:

- categoría;
- marca;
- modelo;
- capacidad;
- color;
- salud de batería;
- condición funcional;
- condición estética;
- IMEI u otro identificador, cuando corresponda;
- costo;
- precio de venta;
- estado;
- comentarios;
- fotografías.

Los estados iniciales son:

- Disponible;
- Reservado;
- Vendido;
- En revisión;
- Archivado.

Cada equipo representa una unidad individual y su disponibilidad debe responder a las operaciones relacionadas. Cada producto pertenece a una sola categoría específica. Los productos individualizables se cargan unidad por unidad; para iPhone el IMEI individual es obligatorio. Los demás productos pueden administrarse por cantidad cuando no requieran identidad por unidad.

La baja por robo o pérdida es una operación trazable que retira el equipo de la disponibilidad. El borrado físico se reserva para cargas erróneas o de prueba sin historia comercial ni dependencias críticas.

### 9.2. Inventario de accesorios

Administra productos controlados por cantidad, como fundas, vidrios, cables, cargadores, auriculares y otros accesorios.

La información funcional principal comprende:

- categoría;
- nombre;
- marca;
- variante;
- SKU;
- datos adicionales;
- costo;
- precio;
- estado;
- cantidad disponible;
- comentarios;
- fotografías.

La cantidad disponible debe disminuir con las ventas y mantenerse consistente ante cambios en las operaciones relacionadas.

Cada producto administrado por cantidad puede definir un stock mínimo. Cuando la cantidad actual sea igual o inferior a ese umbral, BCM SOFT debe mostrar un aviso de bajo stock.

### 9.3. Monedas y costos

El negocio trabaja principalmente con dólares estadounidenses (USD) y pesos argentinos (ARS).

Los costos y precios podrán ingresarse directamente en USD o en ARS utilizando una cotización. Cuando una operación se registre en ARS, debe conservar la cotización utilizada en esa operación.

Los valores históricos no deben cambiar como consecuencia de futuras modificaciones de la cotización general. La rentabilidad debe poder analizarse principalmente en USD.

### 9.4. Ventas

Permite registrar ventas que incluyan:

- uno o más equipos;
- accesorios;
- cliente;
- medio de pago;
- moneda;
- cotización utilizada;
- descuentos o precios personalizados;
- observaciones.

Los medios de pago iniciales son efectivo, transferencia, tarjeta y otro.

Al confirmar una venta:

- los equipos vendidos dejan de estar disponibles y pasan al estado correspondiente;
- las cantidades vendidas de accesorios se descuentan del inventario;
- se conserva el contexto monetario y comercial de la operación.

Una venta puede incluir accesorios con precio personalizado o precio cero cuando se entreguen como regalo.

Si un producto todavía no existe en inventario, el flujo de venta debe permitir una creación/entrada rápida sin abandonar la operación. La venta solo puede confirmarse después de que exista un registro válido; nunca referencia un producto inexistente.

La UX puede ofrecer `Editar venta` y `Eliminar` sobre una venta confirmada, pero esas acciones no reescriben ni borran silenciosamente la historia. Las correcciones conservan valores anteriores, actor, fecha, motivo, stock, costos y auditoría; la eliminación funcional se implementa como cancelación, anulación, reversión o corrección administrativa según corresponda.

### 9.5. Clientes

Mantiene un registro centralizado de clientes. Debe permitir:

- crear y editar clientes;
- buscar clientes;
- consultar su historial de compras;
- consultar sus reservas;
- consultar otras operaciones relacionadas.

Debe ser posible crear un cliente durante una venta sin abandonar esa operación.

Al crear un cliente, el sistema debe advertir posibles duplicados y bloquear únicamente cuando exista un identificador suficientemente fuerte. El nombre por sí solo no es criterio seguro de unicidad; el criterio definitivo deberá contemplar futuros datos normalizados como teléfono, email o documento.

### 9.6. Plan canje

Permite que una venta incluya uno o múltiples equipos entregados por el cliente como parte de pago.

En un plan canje, BCM SOFT debe:

- registrar el equipo recibido con los mismos datos funcionales que cualquier otro equipo;
- registrar su valor de toma;
- descontar ese valor del saldo que debe pagar el cliente;
- ingresar el equipo recibido al inventario;
- utilizar el valor de toma como costo inicial del equipo recibido;
- mantener la relación entre el equipo recibido y la venta que originó su ingreso.

Cada equipo recibido ingresa inicialmente como `Available`; no pasa por `Under Review` de forma automática.

### 9.7. Reservas

Permite asociar temporalmente un equipo disponible con un cliente. Una reserva registra:

- equipo;
- cliente;
- monto de seña;
- fecha;
- vencimiento elegido para esa reserva;
- observaciones.

Mientras una reserva esté activa, el equipo debe figurar como reservado. La duración habitual ronda diez días, pero debe poder elegirse por reserva. La seña es reembolsable. Al alcanzar el vencimiento, el sistema debe avisar y recordar la gestión de su devolución, sin ejecutar automáticamente un movimiento financiero todavía no definido. Si la reserva se cancela, el equipo debe recuperar el estado que corresponda. Una reserva activa puede derivar posteriormente en una venta.

### 9.8. Proveedores

Mantiene un registro básico de proveedores con:

- nombre;
- contacto;
- teléfono;
- país;
- observaciones.

El registro de compras y movimientos de ingreso podrá incorporarse en una evolución posterior.

### 9.9. Configuración

Permite administrar datos comerciales variables sin requerir cambios en el producto. Comprende inicialmente:

- categorías;
- marcas;
- modelos;
- capacidades;
- colores;
- condiciones estéticas;
- condiciones funcionales;
- medios de pago;
- tipos de producto;
- cotización de referencia;
- otros catálogos necesarios para la operación.

### 9.10. Lista de precios

Genera una lista de productos disponibles para la venta. Debe servir para:

- consulta interna;
- copiar información;
- compartir por WhatsApp;
- obtener una salida de texto ordenada y lista para enviar.

La lista debe mostrar únicamente productos disponibles para comercialización.

PDF, imagen, impresión especializada e integración directa con WhatsApp no son prioridad de V1 y requieren una decisión posterior.

### 9.11. Dashboard

Es una prioridad alta de MVP/V1 y resume información relevante del negocio. Debe filtrar por día, semana, mes o rango personalizado desde/hasta. La línea base medible incluye:

- equipos disponibles;
- accesorios disponibles;
- ingresos por ventas del período en ARS y USD;
- cantidad de equipos/productos individualizados vendidos;
- cantidad de unidades de productos por cantidad/accesorios vendidas;
- productos más vendidos;
- ganancia bruta y margen por producto;
- ganancia bruta total en ARS y USD;
- gastos registrados del período;
- resultado del negocio en ARS y USD;
- productos reservados;
- productos con bajo stock;
- operaciones recientes.

`Ingresos por ventas − costo de mercadería vendida = ganancia bruta`; `ganancia bruta − gastos registrados = resultado del negocio`. BCM SOFT no denomina a este resultado “ganancia neta” porque V1 no implementa impuestos, amortizaciones, intereses completos ni contabilidad general. La conversión y el redondeo ARS/USD deben cerrarse antes de implementar los cálculos.

### 9.12. Usuarios y negocio

Representa la necesidad funcional de que un negocio tenga múltiples usuarios y de que, en el futuro, distintos negocios similares utilicen BCM SOFT con información independiente.

Inicialmente BCM operará con un único User real `Owner/Admin` con acceso total. V1 permanece preparado para múltiples Users, creación de usuarios, roles definidos en código y permisos por operación/sección. Un vendedor puede acceder a ventas y stock sin recibir automáticamente costos, ganancias o gastos. No se requiere un IAM dinámico.

### 9.13. Gastos

Permite registrar egresos del negocio, incluidos muebles, inversiones, servicios y otros gastos. Cada registro debe conservar fecha, categoría, descripción, importe, moneda/cotización cuando corresponda, autor y trazabilidad. Los gastos se muestran en el dashboard y participan del resultado del negocio conforme a las definiciones económicas de V1. La lista definitiva de categorías requiere decisión previa.

### 9.14. Garantías

BCM SOFT distingue dos capacidades: **Customer Warranty**, ofrecida por el negocio a su cliente, y **Supplier Warranty**, ofrecida por un proveedor al negocio. No son el mismo lifecycle ni se compensan entre sí.

Como mínimo, cada Equipment puede conservar fecha de compra/recepción, plazo de garantía del proveedor y vencimiento para consultar si sigue vigente. Los plazos predeterminados, la cobertura de Customer Warranty y los flujos de reclamo requieren una decisión antes de implementarse.

### 9.15. Financiamiento

El producto debe admitir ventas financiadas de uso ocasional, con cantidad y máximo de cuotas, intereses, recargos y condiciones aplicables. El alcance V1 exacto se decidirá junto con Payments antes de implementar; no se construirá una plataforma crediticia compleja.

### 9.16. Auditoría funcional

Las operaciones comerciales relevantes deben conservar trazabilidad suficiente para comprender qué ocurrió y mantener relacionado su efecto sobre inventario, ventas, reservas y equipos recibidos mediante plan canje.

El alcance exacto de los eventos y datos auditados se definirá en fases posteriores.

## 10. Flujos principales

### 10.1. Venta de equipos y accesorios

1. El usuario consulta productos disponibles.
2. Selecciona uno o más equipos y las cantidades de accesorios.
3. Asocia un cliente existente o crea uno durante la operación.
4. Registra moneda, cotización cuando corresponda, medio de pago, precios o descuentos y observaciones.
5. Si falta un producto, realiza su creación/entrada rápida y valida que el registro de inventario exista.
6. Confirma la venta.
7. Los equipos dejan de estar disponibles y el stock de accesorios disminuye.
8. La operación queda incorporada al historial del cliente y a los resultados del negocio.

### 10.2. Venta con plan canje

1. Se inicia una venta.
2. Se registran los datos y el valor de toma de uno o más equipos entregados por el cliente.
3. El valor de toma reduce el saldo de la venta.
4. Al confirmar la operación, cada equipo recibido ingresa al inventario como `Available` con su valor de toma como costo inicial.
5. La venta y todos los equipos recibidos permanecen relacionados.

### 10.3. Creación y conversión de una reserva

1. Se seleccionan un equipo disponible y un cliente.
2. Se registran la seña, la fecha y las observaciones.
3. El equipo pasa a estar reservado mientras la reserva permanezca activa.
4. La reserva puede convertirse posteriormente en una venta, manteniendo la relación entre ambas operaciones.

### 10.4. Cancelación de una reserva

1. Se identifica la reserva activa.
2. Se registra su cancelación conforme a las políticas que se definan.
3. El equipo recupera el estado que corresponda y vuelve a estar disponible cuando sea aplicable.

### 10.5. Consulta y difusión de disponibilidad

1. El usuario genera la lista de precios.
2. BCM SOFT incluye únicamente productos disponibles para comercialización.
3. La información puede consultarse, copiarse, imprimirse o compartirse.

## 11. Reglas funcionales generales

1. Los equipos individualizados y los accesorios por cantidad deben gestionarse de forma diferenciada.
2. Un equipo vendido no puede permanecer disponible.
3. Un equipo con una reserva activa debe identificarse como reservado.
4. La cancelación de una reserva debe restaurar el estado que corresponda al equipo.
5. La venta de accesorios debe descontar las cantidades vendidas.
6. Un plan canje debe ingresar el equipo recibido al inventario y relacionarlo con la venta de origen.
7. El valor de toma de un equipo debe reducir el saldo de la venta y convertirse en su costo inicial.
8. Toda operación realizada en ARS mediante una cotización debe conservar la cotización utilizada.
9. Los valores históricos no deben cambiar cuando cambie la cotización de referencia.
10. Las ventas pueden aplicar descuentos o precios personalizados.
11. Un accesorio entregado como regalo puede registrarse con precio cero sin omitir su salida del inventario.
12. La lista de precios solo debe incluir productos disponibles para comercialización.
13. Las operaciones relacionadas deben mantener coherentes el inventario, los estados y las cantidades.
14. Las operaciones comerciales relevantes deben conservar trazabilidad funcional.
15. Toda modificación, anulación, reversión o recuperación utiliza la operación explícita definida; los casos con dependencias no reversibles esperan su Decision Gate.
16. Cada producto pertenece a exactamente una categoría específica.
17. Un iPhone se registra por unidad y exige IMEI; un producto no individualizable puede gestionarse por cantidad.
18. Una venta confirmada solo se corrige mediante historia versionada/compensatoria y nunca mediante edición destructiva.
19. Una venta confirmada no se elimina físicamente mediante el flujo de producto.
20. Robo o pérdida de Equipment produce una baja operacional trazable; no un borrado físico.
21. Una Sale puede contener múltiples Trade-Ins.
22. Stock actual igual o inferior al mínimo configurado produce un aviso.
23. Customer Warranty y Supplier Warranty son conceptos separados.

Las reglas detalladas de consistencia, reversión y trazabilidad se desarrollarán en `DOMAIN.md` durante BCM-002.

## 12. Configurabilidad

Los datos comerciales que cambian habitualmente deben administrarse como configuraciones o catálogos, sin requerir modificaciones de código.

Esto incluye categorías, marcas, modelos, capacidades, colores, condiciones, medios de pago, tipos de producto, cotización de referencia y otros catálogos que se identifiquen como necesarios.

La configuración debe reducir la carga repetida y permitir que cada negocio adapte los valores de uso habitual dentro de los límites funcionales definidos.

## 13. Evolución futura

BCM SOFT debe evolucionar como una plataforma reutilizable para comercios similares. La evolución podrá contemplar más negocios, sucursales, integraciones, canales de venta y capacidades financieras o analíticas una vez que sus necesidades sean definidas y priorizadas.

Las funciones futuras no forman parte de V1 por defecto. Su incorporación requerirá una definición explícita de alcance en el roadmap.

## 14. Fuera de alcance de V1

Quedan fuera de V1, salvo redefinición posterior:

- facturación electrónica;
- integración con Mercado Libre;
- integración con WhatsApp API;
- ecommerce;
- contabilidad completa;
- conciliación bancaria;
- plataforma crediticia avanzada, scoring, cobranza o contabilidad de préstamos;
- automatización avanzada de garantías y reclamos;
- sistema de tickets;
- inteligencia artificial;
- múltiples monedas internacionales adicionales;
- aplicación móvil nativa;
- integraciones con terceros;
- analítica empresarial avanzada.

Estas capacidades podrán evaluarse para versiones futuras.

## 15. Principios del producto

1. Evitar cargar la misma información más de una vez.
2. Mantener sincronizados los módulos relacionados.
3. Priorizar la trazabilidad de las operaciones comerciales.
4. Evitar inconsistencias de stock.
5. Mantener el historial financiero de las operaciones.
6. Permitir configurar catálogos sin modificar código.
7. Diseñar BCM SOFT como un producto reutilizable, no como una aplicación descartable exclusiva para BCM.
8. Priorizar en la primera versión la estabilidad y el uso real por encima de la cantidad de funcionalidades.

## 16. Criterios de éxito iniciales

La primera versión se considerará funcionalmente exitosa cuando:

- BCM pueda utilizarla en su operación comercial diaria;
- el inventario permita conocer la disponibilidad real de equipos y accesorios;
- las ventas actualicen correctamente los equipos y las cantidades relacionadas;
- los planes canje incorporen y relacionen los equipos recibidos;
- las reservas reflejen correctamente la disponibilidad de los equipos;
- los usuarios puedan consultar el historial de clientes y operaciones;
- los valores históricos conserven la moneda y cotización utilizadas;
- los resultados comerciales puedan analizarse en USD y ARS;
- los gastos y el resultado del negocio puedan consultarse por período en ARS y USD;
- los catálogos habituales puedan administrarse sin cambios en el producto;
- la lista de precios y el dashboard brinden información útil para la actividad diaria;
- las operaciones relevantes cuenten con trazabilidad funcional;
- el uso real no produzca inconsistencias de stock entre módulos relacionados.

Las métricas cuantitativas y los mecanismos de validación se definirán en fases posteriores.

## 17. Decisiones pendientes

Las siguientes cuestiones requieren definición funcional posterior y no se resuelven en este documento:

- detalle de una corrección de venta cuando existan productos revendidos u otras dependencias posteriores;
- permisos definitivos y efectos financieros de anulaciones/correcciones;
- tratamiento de devoluciones y cambios;
- plazos predeterminados, cobertura y lifecycle de Customer/Supplier Warranty;
- profundidad V1 del financiamiento y su integración con Payments;
- compras a proveedores y movimientos de ingreso;
- control de caja y cierres;
- necesidad y alcance de múltiples sucursales;
- movimientos y stock entre sucursales;
- reglas de descuentos y promociones;
- tratamiento de impuestos;
- tipos y emisión de comprobantes;
- aplicación y registro financiero de la seña al convertir, cancelar o vencer una reserva;
- efecto operacional del vencimiento sobre reserva y Equipment, sin automatizar devolución;
- categorías definitivas de gastos y tratamiento interno de inversiones;
- criterio fuerte exacto para impedir Customers duplicados;
- convención y redondeo para agregados ARS/USD del dashboard;
- alcance detallado de la auditoría funcional;
- matriz final de permisos por rol dentro del RBAC definido;
- alcance del aislamiento entre negocios;
- formatos de lista de precios posteriores al texto V1;
- tratamiento de diferencias de cotización y redondeos;
- estados y transiciones detalladas de equipos y operaciones.
