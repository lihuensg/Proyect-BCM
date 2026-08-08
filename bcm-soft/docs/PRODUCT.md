# BCM SOFT — Definición del producto

**Estado:** Completed  
**Fase:** BCM-001 — Product Definition

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
6. Analizar la rentabilidad principalmente en USD sin alterar valores históricos.
7. Permitir que los catálogos comerciales habituales sean configurables.
8. Brindar una visión resumida y actual del negocio.
9. Validar una primera versión estable mediante el uso cotidiano de BCM.
10. Sentar una definición funcional reutilizable para negocios similares.

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
- dashboard básico;
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

Cada equipo representa una unidad individual y su disponibilidad debe responder a las operaciones relacionadas.

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

### 9.5. Clientes

Mantiene un registro centralizado de clientes. Debe permitir:

- crear y editar clientes;
- buscar clientes;
- consultar su historial de compras;
- consultar sus reservas;
- consultar otras operaciones relacionadas.

Debe ser posible crear un cliente durante una venta sin abandonar esa operación.

### 9.6. Plan canje

Permite que una venta incluya un equipo entregado por el cliente como parte de pago.

En un plan canje, BCM SOFT debe:

- registrar el equipo recibido con los mismos datos funcionales que cualquier otro equipo;
- registrar su valor de toma;
- descontar ese valor del saldo que debe pagar el cliente;
- ingresar el equipo recibido al inventario;
- utilizar el valor de toma como costo inicial del equipo recibido;
- mantener la relación entre el equipo recibido y la venta que originó su ingreso.

### 9.7. Reservas

Permite asociar temporalmente un equipo disponible con un cliente. Una reserva registra:

- equipo;
- cliente;
- monto de seña;
- fecha;
- observaciones.

Mientras una reserva esté activa, el equipo debe figurar como reservado. Si la reserva se cancela, el equipo debe recuperar el estado que corresponda. Una reserva activa puede derivar posteriormente en una venta.

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
- imprimir;
- exportar en formatos que se definan posteriormente.

La lista debe mostrar únicamente productos disponibles para comercialización.

### 9.11. Dashboard

Resume información relevante del negocio. Los indicadores iniciales son:

- equipos disponibles;
- accesorios disponibles;
- ventas del período;
- facturación;
- rentabilidad;
- productos reservados;
- productos con bajo stock;
- operaciones recientes.

Las reglas detalladas de cálculo se definirán posteriormente.

### 9.12. Usuarios y negocio

Representa la necesidad funcional de que un negocio tenga múltiples usuarios y de que, en el futuro, distintos negocios similares utilicen BCM SOFT con información independiente.

V1 contempla autenticación, un negocio u organización, usuarios y permisos básicos. El detalle de organizaciones, roles, permisos y aislamiento se definirá en fases posteriores.

### 9.13. Auditoría funcional

Las operaciones comerciales relevantes deben conservar trazabilidad suficiente para comprender qué ocurrió y mantener relacionado su efecto sobre inventario, ventas, reservas y equipos recibidos mediante plan canje.

El alcance exacto de los eventos y datos auditados se definirá en fases posteriores.

## 10. Flujos principales

### 10.1. Venta de equipos y accesorios

1. El usuario consulta productos disponibles.
2. Selecciona uno o más equipos y las cantidades de accesorios.
3. Asocia un cliente existente o crea uno durante la operación.
4. Registra moneda, cotización cuando corresponda, medio de pago, precios o descuentos y observaciones.
5. Confirma la venta.
6. Los equipos dejan de estar disponibles y el stock de accesorios disminuye.
7. La operación queda incorporada al historial del cliente y a los resultados del negocio.

### 10.2. Venta con plan canje

1. Se inicia una venta.
2. Se registran los datos y el valor de toma del equipo entregado por el cliente.
3. El valor de toma reduce el saldo de la venta.
4. Al confirmar la operación, el equipo recibido ingresa al inventario con ese valor como costo inicial.
5. La venta y el equipo recibido permanecen relacionados.

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
15. Las reglas exactas de modificación, anulación, reversión y recuperación se definirán antes de habilitar esos comportamientos.

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
- financiamiento avanzado;
- garantías avanzadas;
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
- la rentabilidad pueda analizarse principalmente en USD;
- los catálogos habituales puedan administrarse sin cambios en el producto;
- la lista de precios y el dashboard brinden información útil para la actividad diaria;
- las operaciones relevantes cuenten con trazabilidad funcional;
- el uso real no produzca inconsistencias de stock entre módulos relacionados.

Las métricas cuantitativas y los mecanismos de validación se definirán en fases posteriores.

## 17. Decisiones pendientes

Las siguientes cuestiones requieren definición funcional posterior y no se resuelven en este documento:

- reglas exactas para modificar una venta confirmada;
- reglas y permisos de anulación;
- efectos de anulaciones y correcciones sobre inventario e historial financiero;
- tratamiento de devoluciones y cambios;
- alcance y políticas de garantías;
- opciones de financiamiento;
- compras a proveedores y movimientos de ingreso;
- control de caja y cierres;
- necesidad y alcance de múltiples sucursales;
- movimientos y stock entre sucursales;
- reglas de descuentos y promociones;
- tratamiento de impuestos;
- tipos y emisión de comprobantes;
- políticas de reserva, cancelación y tratamiento de señas;
- vencimiento automático de reservas;
- reglas de bajo stock para accesorios;
- fórmulas y períodos exactos de los indicadores del dashboard;
- alcance detallado de la auditoría funcional;
- definición detallada de tipos de usuario y permisos;
- alcance del aislamiento entre negocios;
- formatos de exportación de la lista de precios;
- tratamiento de diferencias de cotización y redondeos;
- estados y transiciones detalladas de equipos y operaciones.
