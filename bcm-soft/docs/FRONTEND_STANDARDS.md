# Frontend Engineering Standards

Propósito: definir los estándares obligatorios de ingeniería frontend de BCM SOFT.

Estado: `Completed`.

Alcance: SPA administrativa basada en React, TypeScript y Vite. Este documento establece criterios de implementación; no agrega dependencias ni define la apariencia visual.

## 1. Frontend philosophy

- Organizar por feature y mantener un flujo de datos explícito.
- Tratar el server state como una categoría distinta del estado de UI.
- Mantener al backend como autoridad de reglas, permisos, aislamiento tenant y cálculos comerciales.
- Preferir componentes pequeños, composición antes que abstracción y responsabilidades claras.
- Diseñar accesibilidad, responsive y estados loading/error/empty como parte de cada feature.
- No crear estado global, abstracciones o componentes por anticipación.
- Optimizar claridad y mantenibilidad, no una cantidad mínima de archivos o líneas.

## 2. TypeScript

TypeScript debe ejecutarse en modo `strict`. Además, el proyecto deberá habilitar controles equivalentes a `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` y `useUnknownInCatchVariables`, salvo incompatibilidad documentada.

- No usar `any`; comenzar con `unknown` en fronteras externas y refinarlo.
- Evitar assertions inseguras y objetos dinámicos sin validación.
- Mantener tipos cerca de su feature y evitar tipos globales gigantes.
- Tratar toda respuesta de API como un contrato externo.
- No importar tipos Prisma, entidades de persistencia ni internals del backend.
- El build de Vite no sustituye el typecheck; CI deberá ejecutar TypeScript por separado.

## 3. High-level source structure

La estructura recomendada es orientada por feature:

```text
src/
├── app/                  # composición global y bootstrap
├── features/             # capacidades de producto
├── components/
│   └── ui/               # primitives transversales estables
├── lib/                  # infraestructura frontend transversal
├── hooks/                # hooks realmente transversales
├── styles/               # entrada y fundamentos de estilos
└── assets/               # recursos estáticos
```

Los directorios globales `components`, `pages`, `services` y `utils` no deben convertirse en buckets únicos para toda la aplicación. Las páginas, servicios y utilidades de una feature viven dentro de esa feature.

## 4. Feature ownership

Una feature posee sus contratos de UI, acceso a API y comportamiento:

```text
features/inventory/
├── api/
├── components/
├── hooks/
├── pages/
├── schemas/
├── types/
└── utils/
```

Esta lista es conceptual: se crea una carpeta únicamente cuando tiene contenido y una responsabilidad real. Las dependencias deben apuntar desde la composición hacia las piezas internas, no entre internals arbitrarios de distintas features.

## 5. App-level code

`app/` contiene solamente responsabilidades globales reales: router, providers, bootstrap de autenticación, configuración del query client, error boundary global, app shell, navegación global e inicialización validada del entorno. La lógica propia de inventario, ventas, clientes u otra feature no pertenece allí.

## 6. Shared UI

`components/ui` contendrá primitives reutilizables y estables, por ejemplo Button, Input, Select, Dialog, Drawer, primitives de Table, Badge, Tooltip y Toast. Estas piezas no conocerán endpoints ni reglas de una feature. Dos usos no bastan para promover un componente: debe existir una interfaz transversal madura y coherente con `DESIGN_SYSTEM.md`.

## 7. Feature-specific components

Los componentes con vocabulario o comportamiento de dominio permanecen en su feature. Por ejemplo, `EquipmentStatusBadge` comienza en Inventory. Solo se comparte cuando exista una necesidad cross-feature real y pueda exponerse sin filtrar internals.

## 8. Page responsibility

Una page coordina route params, hooks de la feature, layout, dialogs y los estados generales de pantalla. No debe hacer fetch manual disperso, reproducir cálculos de negocio críticos, duplicar llamadas ni mezclar cientos de líneas de JSX con responsabilidades independientes. Cuando crezca, se extraen secciones por responsabilidad observable.

## 9. Server state

Inventario, ventas, clientes, reservas, catálogos y usuario actual son server state. Para V1 se adopta **TanStack Query** como propietario de su ciclo de vida: cache, deduplicación, estado de request, invalidación, reintentos controlados y mutations.

- Las funciones de API siguen perteneciendo a la feature; TanStack Query no reemplaza esa capa.
- Cada dato remoto tiene una única fuente de verdad en cache.
- Redux, Zustand, Context o copias en component state no deben duplicar server state.
- `staleTime`, retención e invalidación se deciden por volatilidad y riesgo del recurso, no mediante un valor global arbitrario.

## 10. Local UI state

Usar `useState` o `useReducer` cerca del consumidor para dialog abierto, tab seleccionada, panel colapsado o selección temporal. Elevar estado solo hasta el ancestro común necesario y eliminarlo cuando pueda derivarse de props, URL o server state.

## 11. Global client state

V1 no adopta Redux ni Zustand por defecto. Un store global solo se evaluará ante un workflow efímero y complejo que atraviese rutas o una preferencia realmente global que Context no resuelva con claridad. No almacenará listas, cache de API ni valores de cada formulario. Su adopción exige un caso concreto, propietario, ciclo de vida y revisión de datos sensibles.

## 12. Form state

Para formularios no triviales se adopta **React Hook Form**: permite modelar validación por campo, datos anidados, dirty state, pending y errores de servidor sin convertir cada pulsación en estado global. Un formulario simple puede usar estado local controlado si resulta más claro. Form state y server cache son propietarios separados; al completar una mutation se reconcilia mediante su respuesta e invalidación explícita.

## 13. Schema validation

Se adopta **Zod** para schemas frontend TypeScript-friendly en formularios y fronteras externas. La validación cliente mejora feedback y evita estados inválidos de UI, pero nunca es un control de seguridad: el backend vuelve a validar todo.

Las respuestas críticas o de forma no trivial deben parsearse antes de entrar a la aplicación. Contratos estables podrían compartirse en el futuro mediante un paquete independiente, pero no se importarán DTOs internos, schemas de persistencia ni código del backend para evitar acoplamiento.

## 14. API layer

Habrá un cliente HTTP común para base URL, `credentials`, CSRF, headers transversales, parsing JSON, normalización de errores y captura de `requestId`. Sobre él, cada feature expondrá funciones explícitas como `listEquipment` o `createReservation`.

- No usar `fetch` directamente en pages o componentes de presentación.
- No ocultar fallas con datos mock ni respuestas vacías.
- El cliente produce un error tipado a partir de `{ code, message, details?, requestId }` y preserva status y `requestId` para soporte.
- Los contratos públicos usan JSON `camelCase` y no filtran nombres de base de datos.

## 15. Credentials

La sesión V1 usa cookie `HttpOnly`, `Secure` y `SameSite` según `SECURITY.md`. El cliente enviará credenciales conforme al despliegue aprobado, normalmente `credentials: "include"`. El frontend no puede leer la cookie y no almacenará session tokens, passwords o auth secrets en LocalStorage, SessionStorage o estado serializado; tampoco construirá Bearer tokens para esta sesión.

## 16. CSRF frontend responsibility

Para métodos mutantes, el cliente común obtiene y conserva el token CSRF mediante el mecanismo definido por el backend y lo envía en el header permitido. No genera tokens propios, no los incluye en URLs y no desactiva la defensa para resolver problemas locales. Las respuestas de token o sesión se tratan como sensibles y no se registran.

## 17. Current user / organization

El contexto de sesión puede exponer usuario, organización activa y permisos relevantes obtenidos del endpoint seguro de bootstrap. Es información para navegación y UX, no autoridad. El backend valida membership, tenant y operación en cada request; el cambio de organización ocurre únicamente mediante el flujo autorizado de API.

## 18. Authorization UX

La UI usa permissions para ocultar o deshabilitar acciones imposibles y mostrar motivos útiles. No dispersará comparaciones `role === "OWNER"`; usará helpers/hooks centralizados basados en permisos, por ejemplo `useCanPermission`. Ocultar un control no aporta seguridad: el backend debe omitir datos sensibles y rechazar operaciones no autorizadas.

## 19. Route guards

El routing distingue rutas públicas, rutas autenticadas y páginas sensibles a permisos. Los guards esperan el bootstrap de sesión antes de decidir, redirigen por UX y muestran acceso denegado cuando corresponde. Nunca reemplazan autenticación o autorización backend ni deben asumir que conocer una URL concede acceso.

## 20. API contracts

El frontend depende exclusivamente de contratos HTTP documentados: parámetros, DTOs públicos, códigos de error, decimales string y paginación. No utiliza modelos Prisma, columnas internas, audit internals, hashes, credenciales ni campos administrativos no previstos para el browser.

## 21. Decimal handling

Dinero y cotizaciones llegan y salen como strings decimales canónicos. No deben convertirse indiscriminadamente a `number` para cálculos financieros críticos. El backend calcula y valida importes autoritativos. Una librería decimal cliente se evaluará solo si aparece un cálculo interactivo real que lo justifique, con reglas de escala y redondeo documentadas.

## 22. Formatting money

El valor de dominio se conserva separado de su presentación: nunca se almacena `"$ 1.200"` como importe. Un formatter transversal recibe string decimal, moneda (`ARS` o `USD`) y locale, y presenta mediante APIs internacionales adecuadas sin alterar el valor canónico. La moneda nunca se deduce solo por el símbolo.

## 23. Dates

Parsear explícitamente fechas de negocio y timestamps ISO; no depender del parseo ambiguo del browser. Los timestamps técnicos se muestran en el timezone/locale correspondiente, mientras las fechas de negocio conservan su semántica. Cuando una regla dependa de la organización, usar su timezone configurado y no el timezone del dispositivo. Las conversiones deben concentrarse en utilidades probadas.

## 24. Lists

Todo listado potencialmente grande usa pagination, search, filtering y sorting server-side. El browser no descarga el universo de registros para luego filtrarlo. La UI conserva el resultado vigente durante refetch cuando sea seguro y señala claramente que se está actualizando.

## 25. Pagination

Respetar los contratos de `BACKEND_STANDARDS.md`: offset para catálogos pequeños (`items`, `page`, `pageSize`, `total`) y cursor/keyset para historiales (`items`, `nextCursor`, `hasMore`). El default es 25 y el máximo 100 salvo contrato específico. Page, pageSize, filtros y sort forman parte de la query key; los estados navegables se sincronizan con URL.

## 26. URL as state

Search, filtros, sort y página de listados importantes se representan en query params normalizados, por ejemplo `/inventory?page=2&status=available&search=iphone`. Esto preserva refresh, back y enlaces. Estado efímero como dialog abierto o hover permanece local. Parámetros inválidos vuelven a defaults seguros sin construir filtros arbitrarios.

## 27. Search

Las búsquedas incrementales usan debounce de referencia de 300 ms, ajustable según medición, y permiten submit inmediato con Enter. La query tooling cancela o ignora resultados obsoletos; limpiar la búsqueda actualiza URL y página de forma coherente. No emitir una request por tecla sin control.

## 28. Filtering

Los filtros se construyen desde opciones permitidas por el contrato de API y se serializan de forma determinista. La UI puede mostrar chips activos y una acción de limpiar. No se envían expresiones, columnas o operadores arbitrarios al backend.

## 29. Sorting

Cada columna ordenable mapea a un identificador público permitido por API. La UI comunica dirección y estado accesiblemente, y restablece la página cuando el contrato lo requiera. Nunca envía nombres de columnas de persistencia ni presume ordenamiento cliente sobre una página parcial.

## 30. Tables

Para tablas simples se prefieren elementos semánticos y primitives del Design System. Se adopta **TanStack Table** solo cuando una feature necesita combinar comportamiento complejo de sorting, filtering, pagination, selection o visibilidad de columnas; es headless y no aporta por sí sola estilos o accesibilidad.

Las listas grandes operan en modo manual server-side. Cada tabla diseña loading, empty, error y responsive: en móvil puede priorizar columnas, usar scroll controlado o una representación en cards sin duplicar la feature. V1 no adopta una data grid pesada.

## 31. Table rendering performance

Server-side pagination es la primera defensa ante listas grandes. No virtualizar tablas pequeñas: agrega complejidad de foco, medición y accesibilidad. La virtualización se considera solo tras medir un cuello de render real y validar navegación por teclado, scroll y lectores de pantalla.

## 32. Mutations

Toda mutation debe:

1. exponer progreso sin bloquear toda la aplicación;
2. prevenir el doble submit accidental;
3. enviar idempotency key cuando el contrato la requiera;
4. distinguir validación y conflictos de dominio;
5. reconciliar o invalidar las queries relacionadas;
6. presentar el resultado final con claridad.

Deshabilitar el botón es protección de UX, no idempotencia. La respuesta del backend es la autoridad del estado resultante.

## 33. Optimistic updates

No son la opción predeterminada. Se permiten para cambios simples, reversibles y de bajo riesgo cuando exista rollback claro. Confirmar o cancelar ventas, ajustar stock, registrar trade-in y reservar stock crítico esperan respuesta autoritativa; no deben simular éxito antes de recibirla.

## 34. Query invalidation

Cada mutation documenta qué query keys afecta. Invalidar el detalle y los listados relacionados, o escribir en cache solo cuando la respuesta sea completa y la consistencia evidente. Evitar tanto `invalidate everything` como actualizaciones manuales frágiles que repliquen reglas backend.

## 35. Loading states

Diseñar por separado initial loading, background refetch y mutation pending. El initial loading reserva el espacio apropiado; un refetch conserva datos vigentes cuando no haya riesgo de confusión y muestra indicador discreto; una mutation bloquea únicamente controles incompatibles. Skeletons se usan si explican la estructura, no como decoración obligatoria.

## 36. Empty states

Distinguir sin datos iniciales, filtros sin resultados, falta de permiso y error. Cada estado ofrece la acción pertinente —crear si se permite, limpiar filtros o volver— y no atribuye a “vacío” lo que en realidad es un fallo o restricción.

## 37. Error states

Mapear status y `code` del contrato a categorías de validación, 401, 403, 404, 409/conflict, 429, servidor y red. Mostrar mensajes seguros y accionables, con `requestId` cuando ayude a soporte. Nunca presentar traces, mensajes Prisma/NestJS ni detalles internos. Los errores desconocidos conservan su causa para observabilidad futura y muestran fallback seguro.

## 38. Error boundaries

Debe existir un boundary app-level para fallas inesperadas de render y boundaries route-level donde permitan recuperar o navegar sin perder toda la app. Incluyen una salida segura y futura integración de observabilidad. No capturan como flujo normal errores de query, mutation o validación, que se manejan en su contexto.

## 39. Toasts

Los toasts comunican confirmaciones o feedback breve no bloqueante. Un error que requiere corrección aparece también cerca del campo, formulario o acción; no desaparece únicamente en un toast. Evitar ráfagas duplicadas durante refetch/retry y asegurar anuncio accesible sin robar foco innecesariamente.

## 40. Forms

Todo formulario ofrece labels persistentes, ayudas asociadas, validación, errores, estado pending/disabled coherente y operación por teclado. Debe rastrear dirty state cuando perder cambios sea costoso y confirmar navegación solo ante riesgo real. Formularios extensos se dividen en secciones semánticas, no en un mega componente.

## 41. Server validation errors

La capa de mutation conserva `code` y `details`. Cuando el backend entregue un mapa seguro de campos, se traduce a errores de React Hook Form; los conflictos cruzados o generales aparecen a nivel formulario. Un error útil del backend no se reemplaza por “algo salió mal”, pero su texto no se muestra ciegamente si puede contener internals.

## 42. Dynamic catalogs

Brands, models, categories, payment methods y demás catálogos administrables se consultan por API y se cachean según su volatilidad. No se hardcodean como opciones funcionales. Loading, vacío, error y permisos del catálogo deben impedir un submit ambiguo.

## 43. Business states

Estados críticos no se editan con un select genérico. Cada transición relevante se representa como acción semántica respaldada por endpoint, permiso, precondiciones y feedback propios; por ejemplo reservar, vender o ajustar, en vez de asignar arbitrariamente `Equipment.status`.

## 44. Dangerous actions

Cancelar una venta, ajustar stock o desactivar un usuario exige confirmación clara con objeto, consecuencia y, si el contrato lo requiere, motivo. La acción primaria debe nombrar el efecto y evitar confirmaciones genéricas. El dialog es UX; permiso, validación y audit continúan en backend.

## 45. Double submit

Al comenzar submit, impedir otro intento sobre la misma instancia y mantener estable la idempotency key durante los reintentos explícitos de esa operación. Rehabilitar controles según resultado y permitir recuperación. Nunca generar dos keys por doble click ni asumir que el estado disabled evita requests concurrentes en todos los clientes.

## 46. Accessibility baseline

BCM SOFT toma **WCAG 2.2 nivel AA** como referencia futura, sin declarar certificación. El baseline exige HTML semántico, labels, teclado, foco visible, gestión de foco en dialogs, contraste adecuado y significado no dependiente solo de color. Usar ARIA únicamente cuando la semántica nativa no alcance y probar las primitives compartidas como base accesible.

## 47. Keyboard

Forms, dialogs, menús y tablas deben poder operarse razonablemente con teclado siguiendo patrones esperables. No crear elementos clickeables no semánticos ni shortcuts globales agresivos. Si una tabla ofrece acciones por fila, deben ser alcanzables y comprensibles sin mouse.

## 48. Focus

Al abrir un dialog, llevar foco a un destino apropiado dentro; al cerrarlo, devolverlo al disparador si existe. Tras un submit inválido, enfocar o anunciar el primer error útil. En navegación significativa, ubicar foco para comunicar el nuevo contenido sin interrumpir operaciones menores. Nunca esconder el indicador de foco.

## 49. Responsive architecture

La estrategia es mobile-first y debe funcionar desde móvil hasta desktop. Una tabla puede transformarse en cards, priorizar columnas o usar scroll controlado; dialogs pueden convertirse en drawers y layouts reorganizarse. Compartir datos, acciones y comportamiento entre variantes, evitando duplicar una feature completa salvo necesidad probada.

## 50. Breakpoints

Los breakpoints y tokens corresponden a `DESIGN_SYSTEM.md`. Los componentes no inventan valores aislados. Hasta que ese documento se complete, cualquier implementación futura debe usar una escala mínima centralizada y provisional, claramente reemplazable, sin fijar aquí números, colores ni spacing.

## 51. Component APIs

Las APIs reutilizables deben ser pequeñas, tipadas y predecibles. Preferir children, slots y variantes con significado frente a docenas de booleanos (`isSmall`, `isBlue`, `isRounded`). No exponer internals de styling ni opciones que el componente no pueda combinar correctamente.

## 52. Prop drilling

Pasar dos o tres props a través de una jerarquía corta es aceptable. No introducir Context o store solo para eliminarlo. Si el paso se vuelve amplio y conceptualmente transversal, revisar primero ownership, composición y colocación del componente.

## 53. Context

React Context se reserva para sesión/autenticación ya resuelta, tema futuro u otro estado transversal de baja frecuencia, y eventualmente un contexto acotado de feature. No es base de datos ni cache. Separar contexts con ritmos de cambio distintos para no volver a renderizar toda la aplicación.

## 54. Hooks

Un custom hook encapsula comportamiento reusable o una integración con React, no renombra una función trivial. Los hooks de feature permanecen en ella (`useInventoryFilters`, `useSaleForm`); los verdaderamente globales tienen contrato estable. `useCanPermission` centraliza interpretación de permisos para UX sin sustituir backend.

## 55. Effects

`useEffect` se usa para sincronizar con sistemas externos, suscripciones o APIs imperativas. No se usa para calcular valores que pueden derivarse durante render, responder a un click que puede manejarse en el evento ni encadenar cambios de estado. Todo effect declara cleanup y dependencias reales.

## 56. Derived state

No copiar props o server state a state local para mantenerlos “sincronizados”. Calcular valores como nombres completos, totales visuales o flags durante render, y usar memoización solo si cuesta. Cuando un formulario necesita snapshot editable, su inicialización y reset son explícitos y no compiten con la cache.

## 57. Memoization

No agregar `useMemo`, `useCallback` o `memo` por reflejo. Se justifican cuando una identidad estable forma parte del contrato, el cálculo es mediblemente costoso o profiling confirma renders problemáticos. Documentar los casos no evidentes y volver a medir después.

## 58. Performance

Prioridades: pagination server-side, requests deduplicadas, invalidación precisa, route lazy loading, dependencias controladas, imágenes adecuadas y evitar waterfalls. Medir con herramientas de browser y métricas antes de microoptimizar renders. Los presupuestos concretos de performance podrán definirse en la fase correspondiente.

## 59. Code splitting

Las rutas o features grandes pueden cargarse con imports dinámicos y fallback accesible. Mantener el shell estable y manejar fallas de carga. No convertir cada primitive en un chunk: el límite debe seguir una unidad navegable o dependencia pesada que produzca una mejora verificable.

## 60. Images

En listados se cargarán thumbnails o variantes futuras, con dimensiones reservadas, lazy loading y placeholder cuando aporte claridad. No descargar originales enormes ni enviar imágenes base64 en respuestas JSON normales. El pipeline de storage definirá formatos y variantes en una tarea futura; este estándar no lo inventa.

## 61. Bundle dependencies

Antes de agregar una librería se registra el problema concreto, alternativas nativas o existentes, costo de bundle, mantenimiento, accesibilidad, seguridad, compatibilidad y capacidad de tree-shaking. No incorporar una librería completa por una primitive trivial ni duplicar capacidades. Toda dependencia requiere una tarea que la justifique.

## 62. Icons

El Design System elegirá una única familia consistente y su API accesible. No mezclar bibliotecas, copiar SVGs sin control ni usar emojis como iconografía funcional principal. Los icon-only controls requieren nombre accesible y tooltip cuando ayude.

## 63. Routing

Para V1 se adopta **React Router en Data Mode** con una configuración de rutas conocida por `app/`. Aporta rutas anidadas, lazy loading, boundaries y navegación/pending sin exigir el Framework Mode ni reemplazar Vite. TanStack Query conserva la propiedad del server state; loaders se limitan a bootstrap de ruta, redirects o prefetch deliberado, sin crear una segunda cache.

## 64. Route ownership

Cada feature mantiene sus pages y puede exportar una definición de rutas estable; `app/` compone el árbol global. Las features no mutan el router dinámicamente en runtime. Paths, permisos y layouts se pueden inspeccionar desde la composición sin importar internals profundos.

## 65. Authentication bootstrap

Antes de renderizar contenido protegido, la app consulta el endpoint seguro de sesión/current context y modela tres estados: `checking`, `authenticated` y `unauthenticated`. Durante `checking` muestra un shell neutral, sin flash de datos protegidos. Una respuesta autenticada se valida y establece usuario, organización y permissions; una no autenticada entra al flujo público.

## 66. Session expiration

Ante 401 confirmado, detener retries, limpiar cache y estado sensible en memoria, resetear contexto y navegar al login o flujo previsto. Puede preservarse un destino interno seguro para volver después de autenticarse, sin incluir secretos. La coordinación debe evitar que muchas requests disparen loops o múltiples redirecciones.

## 67. 403

Un 403 significa falta de autorización para esa operación, no sesión expirada. Mantener la sesión, mostrar un estado o mensaje de acceso denegado y ofrecer navegación segura. No reintentar automáticamente ni transformar el caso en logout.

## 68. 404 tenant-safe

Para un recurso inexistente o no accesible de otro tenant, mostrar el mismo mensaje neutral de no disponibilidad. La UI no intenta inferir ownership, no revela identificadores alternativos y no promete distinguir causas que el backend deliberadamente unifica.

## 69. Rate limit UX

Ante 429, detener reintentos agresivos, respetar `Retry-After` u otra información segura del contrato y comunicar cuándo intentar nuevamente. Mantener los datos ingresados si es seguro y no crear timers masivos por componente.

## 70. Network retry policy

Queries de lectura pueden reintentarse un número limitado de veces ante fallas transitorias de red o 5xx, con backoff. No reintentar 400/401/403/404 ni validaciones. Las mutations no se reintentan ciegamente; confirmar/cancelar Sale y stock adjustment requieren decisión explícita y, cuando corresponda, la misma idempotency key.

## 71. Offline

V1 no es offline-first. No implementar service-worker data sync, base local, colas de mutations ni resolución de conflictos. Una PWA futura no implica por sí misma soporte offline de datos y requerirá decisión específica.

## 72. LocalStorage

Solo puede guardar preferencias no sensibles, versionadas y prescindibles, por ejemplo una preferencia visual futura. Nunca guarda tokens, passwords, información comercial confidencial, inventario completo, permissions como autoridad ni respuestas de API sensibles. Todo valor leído se valida porque el usuario puede alterarlo.

## 73. URL security

No colocar secretos, datos financieros sensibles ni información personal innecesaria en path o query params. Tokens temporales de invitation/reset solo podrán existir según el flujo de seguridad aprobado, minimizando exposición a history, logs y referrer; deben eliminarse de la URL tan pronto como el contrato lo permita.

## 74. Feature flags

V1 no introduce una plataforma compleja de flags. Si aparece una necesidad futura, un flag controla disponibilidad o rollout de UX, nunca autorización. El backend aplica permissions y reglas aun cuando la UI esté oculta.

## 75. Business logic

El frontend puede derivar previews y habilitación de controles para feedback inmediato, pero no duplica reglas como autoridad. El backend recalcula, valida precondiciones y decide la transición al confirmar. Una discrepancia se muestra y reconcilia; no se fuerza el valor cliente.

## 76. Money preview

El formulario de Sale puede presentar subtotal, trade-in, saldo esperado y ganancia estimada si existe permiso. Los cálculos cliente usan representación decimal segura cuando se adopte y se etiquetan como preview; la confirmación utiliza los importes devueltos por backend. Si difieren, mostrar el resultado autoritativo antes de inducir a error.

## 77. Sensitive financial information

Cost, gross profit y margins se renderizan solo con permission apropiada, pero además deben ser omitidos o protegidos por el backend. No descargar esos campos para ocultarlos con CSS o condicionales. Evitar que aparezcan en logs, atributos DOM, cache persistida o mensajes de error.

## 78. Cache and sensitive data

La cache de TanStack Query vive solamente en memoria en V1. En logout o expiración se ejecuta `queryClient.clear()` y se elimina contexto sensible antes de mostrar otra sesión. En cambio de organización se bloquea la renderización tenant-dependent, se limpia o separa toda cache tenant y se vuelve a obtener el contexto; nunca se presentan datos del tenant anterior durante la transición.

## 79. Query keys

Cada feature define factories de query keys deterministas. Los recursos tenant-scoped incluyen la organización validada, por ejemplo `["org", organizationId, "inventory", filters]`; filtros normalizados evitan keys equivalentes distintas. El organizationId previene colisiones de cache, pero no es control de seguridad y nunca habilita acceso por sí solo.

## 80. Organization switching

El flujo es secuencial y observable:

1. impedir mutations incompatibles y solicitar el switch autorizado al backend;
2. invalidar la identidad de contexto actual y bloquear vistas tenant-dependent;
3. limpiar cache y state específicos de la organización;
4. volver a consultar sesión/current context;
5. resetear filtros, forms y selección propios de features;
6. navegar a una ruta segura y recién entonces renderizar datos nuevos.

Si falla, conservar o restaurar coherentemente el contexto confirmado por backend, sin mezclar caches.

## 81. Feature boundaries

Una feature no importa rutas profundas como `features/sales/components/...` desde otra. Cuando exista uso cross-feature estable, la feature propietaria expone un public entry explícito o la primitive se mueve a shared si perdió semántica de dominio. Evitar dependencias bidireccionales.

## 82. Barrel files

Usarlos solo en boundaries públicos pequeños. No crear barrels recursivos que escondan el origen, carguen módulos innecesarios o provoquen ciclos. Dentro de una feature, imports directos claros son preferibles.

## 83. Circular imports

Los ciclos son un error de ownership o layering y deben resolverse moviendo la responsabilidad o invirtiendo la dependencia mediante un contrato estable. No ocultarlos con aliases, orden de import o hacks del bundler.

## 84. Utils

No habrá un `utils.ts` global gigante. Formatters y herramientas transversales con contrato estable viven en `lib/`; utilidades de venta, inventario u otra capacidad permanecen en su feature. Una función pura de un solo consumidor puede quedarse junto a él.

## 85. Constants

Estados y valores públicos del backend provienen de schemas/tipos de contrato validados y se mapean a labels de UI. Evitar magic strings repetidas, pero también un archivo global de constantes inconexas. Los labels no sustituyen el valor canónico de API.

## 86. Naming

Usar inglés consistente con los términos canónicos del dominio y nombres que expresen responsabilidad, como `EquipmentList`, `SaleDetail` y `ReservationForm`. Evitar `DataComponent`, `HandlerPage`, `GenericModal2` y abreviaturas ambiguas. Las traducciones visibles son presentación y no cambian el naming del código.

## 87. Component size

No hay límite rígido de líneas. Son señales de extracción: varias responsabilidades, múltiples queries o forms independientes, dialogs inconexos, condicionales difíciles y tests frágiles. Extraer por comportamiento o sección coherente, no para alcanzar un número arbitrario.

## 88. Render props / HOCs

Preferir hooks y composición moderna. Render props o HOCs se aceptan únicamente al integrar una API que los requiera o cuando resuelvan un caso mejor de forma demostrable; no introducir patrones heredados como convención nueva.

## 89. CSS strategy

La estrategia visual se definirá en `DESIGN_SYSTEM.md`. Si una tarea futura adopta Tailwind, debe usar tokens, evitar clases arbitrarias repetidas y abstraer solo patrones maduros; no crear wrappers por cada combinación. Esta fase no instala Tailwind ni elige una alternativa de styling.

## 90. Inline styles

Se permiten para valores puntuales verdaderamente dinámicos que no puedan expresarse mediante tokens o variantes. No son la estrategia general de styling y no deben eludir responsive, estados interactivos ni Content Security Policy futura.

## 91. Design System dependency

Este documento no define apariencia. Colores, tipografía, spacing, elevation, motion, breakpoints, iconografía y variantes de primitives pertenecen a `docs/DESIGN_SYSTEM.md`. Los componentes compartidos futuros deberán obedecerlo; hasta entonces no se inventa aquí una identidad visual.

## 92. Accessibility testing

La estrategia de testing debe comprobar roles semánticos, asociación label/control, nombre accesible, interacción por teclado, foco y comportamiento de dialogs. Las herramientas automáticas detectan una parte de los problemas y se complementan con revisión manual de teclado, zoom/reflow y lector de pantalla en flujos críticos.

## 93. Unit tests

Se destinan a helpers puros, formatters de dinero/fechas, permission mapping, hooks con lógica y reducers de UI. Cubrir bordes relevantes del dominio de presentación, evitando tests de getters, passthroughs o detalles internos triviales.

## 94. Component tests

Probar conducta observable: una persona completa campos por label, recibe validación y el submit invoca la acción esperada; un permiso cambia controles; un dialog administra foco. Consultar por role, label y texto. No afirmar nombres de state, hooks internos o estructura incidental del DOM.

## 95. Integration tests

Las features importantes se prueban con API mock controlada en la frontera de red, incluyendo success, validation, conflict, auth, loading y retry. No mockear cada hook propio: renderizar providers y routing cercanos a producción para validar coordinación entre page, form, query y contrato.

## 96. E2E

Reservar E2E para pocos flujos de alto valor: login, alta de inventario, venta, reserva, trade-in y cambio de tenant cuando exista. Mantener datos aislados y verificaciones por comportamiento. Unit/component/integration continúan formando la mayor parte de la suite; BCM-008 definirá la estrategia detallada.

## 97. Test selectors

Orden de preferencia: role con accessible name, label, texto visible y finalmente `data-testid` cuando no exista selector semántico estable. No agregar clases CSS o estructura artificial para tests. Un test difícil de consultar suele señalar un problema de accesibilidad.

## 98. Mock data

Mocks se limitan a tests, fixtures o un entorno de desarrollo explícito. No se mezclan con bundles productivos ni se activan como fallback si falla la API. Deben respetar contratos públicos y tenant boundaries para no enseñar una integración falsa.

## 99. Feature implementation workflow

Toda feature futura sigue este orden:

1. leer PRODUCT, DOMAIN y decisiones aplicables;
2. leer el contrato público de API;
3. identificar permisos, datos sensibles y tenant scope;
4. diseñar estados de UI, loading, empty y error;
5. definir server data, query keys e invalidación;
6. implementar el API de feature;
7. implementar view/form por composición;
8. completar validación y conflictos;
9. verificar responsive;
10. verificar accesibilidad;
11. agregar tests proporcionales al riesgo;
12. revisar Definition of Done.

No empezar por componentes sin comprender contrato y estados.

## 100. Frontend Definition of Done

Una feature no está completa hasta verificar, cuando aplique:

- typecheck estricto, lint, tests y build;
- estados initial loading, refetch, mutation, empty y error;
- validación cliente y errores backend;
- UX de permisos sin asumir seguridad cliente;
- responsive, teclado, foco y semántica;
- ausencia de secretos y datos sensibles innecesarios;
- requests sin duplicación accidental y mutations críticas idempotentes;
- query keys e invalidación tenant-aware;
- cálculo comercial autoritativo en backend;
- documentación o deuda explícita para excepciones.

## 101. AI / Codex rules

Cuando Codex modifique frontend debe:

- leer documentación, contrato y archivos relevantes antes de editar;
- inspeccionar y reutilizar primitives existentes;
- no crear una segunda versión del mismo componente;
- no agregar una dependencia sin tarea y justificación;
- no rediseñar globalmente durante una feature;
- no duplicar lógica de forms o reglas backend;
- no crear hooks triviales ni mover state globalmente por comodidad;
- no esconder errores con fallbacks o mocks;
- no sustituir validación/autorización backend;
- componer JSX grande por responsabilidades, sin fragmentarlo en archivos diminutos sin valor;
- limitar cambios al alcance y reportar los archivos modificados.

## 102. Refactoring

No refactorizar features ajenas salvo que sea imprescindible para la tarea y el cambio siga siendo pequeño. La deuda no bloqueante se documenta para una tarea posterior. Cambios del Design System se realizan de forma deliberada y transversal, no escondidos dentro de una feature.

## 103. Root cause

Antes de agregar otro effect, flag o workaround a un bug, identificar la fuente de verdad, stale state, query key/cache, orden de requests, mismatch de API y responsabilidad de render. Corregir la causa con un test de regresión proporcional; evitar capas sucesivas de patches.

## 104. No duplicate source of truth

Cada estado tiene un propietario: TanStack Query para un `Sale` remoto, React Hook Form para su borrador editable, URL para filtros navegables y estado local para UI efímera. No copiar el mismo `Sale` a Query, store global y component state. La reconciliación entre propietarios ocurre en eventos explícitos.

## 105. Common anti-patterns

Quedan prohibidos como convención:

- un components folder global gigante;
- server state duplicado en Redux/Context;
- `fetch` en todas partes o API calls en componentes de presentación;
- seguridad de negocio implementada solo en frontend;
- pages enormes, Context global para todo y cadenas de effects;
- state derivado duplicado y memoización prematura;
- optimistic updates en operaciones comerciales críticas;
- filtrado cliente sin límite de conjuntos grandes;
- secretos de auth o cache sensible en LocalStorage;
- importar o mostrar internals backend;
- CSS inconsistente y componentes duplicados;
- mega forms genéricos y forks arbitrarios mobile/desktop;
- proliferación de dependencias;
- fallbacks silenciosos de errores o mocks en producción.

## 106. Required technology decisions

Decisiones V1:

| Área | Decisión | Motivo y límite |
|---|---|---|
| Router | React Router, Data Mode | Encaja con una SPA Vite y ofrece rutas anidadas, lazy, pending y boundaries sin adoptar Framework Mode. Loaders no duplican la cache de Query. |
| Server state | TanStack Query | Resuelve lifecycle, cache, deduplicación, mutations e invalidación. No habilita un store global adicional. |
| Form state | React Hook Form en forms no triviales | Modela fields, dirty, pending y errores; forms mínimos pueden continuar con estado local. |
| Schema validation | Zod | Valida datos externos y forms con integración TypeScript. Es UX/contrato, nunca seguridad. |
| Table behavior | HTML/primitives para casos simples; TanStack Table para complejos | Su enfoque headless permite controlar semántica y diseño. No se incorpora una data grid pesada. |

Estas son decisiones documentales. Las dependencias se instalarán únicamente en una tarea de implementación autorizada.

## 107. Proposed V1 stack

- **React:** base de UI declarativa ya establecida por Architecture.
- **TypeScript:** contratos y refactors seguros con configuración estricta.
- **Vite:** toolchain SPA ya establecida; requiere typecheck separado.
- **React Router (Data Mode):** routing y lifecycle de navegación, sin convertirlo en segunda fuente de server state.
- **TanStack Query:** única cache de server state en browser.
- **React Hook Form:** forms no triviales; no obligatorio para cada input aislado.
- **Zod:** parsing/validación en fronteras frontend.
- **TanStack Table:** toolkit condicional para tablas con comportamiento complejo.

No se recomienda por defecto Redux, Zustand, una data grid, librería decimal, framework CSS ni persistencia de cache. Cada incorporación futura necesita un caso concreto.

## 108. Additional reviews

La revisión de este estándar no encontró contradicciones con PRODUCT, DOMAIN, ARCHITECTURE, DATABASE, SECURITY, BACKEND_STANDARDS ni los ADRs vigentes. Por lo tanto:

- `Architecture Review Required`: No.
- `Backend Review Required`: No.
- `Security Review Required`: No.

Si una implementación futura necesita cambiar cookies/sesión, CSRF, tenant isolation, contratos HTTP, representación decimal o el reparto de responsabilidades, deberá registrar la revisión correspondiente antes de implementar.

## Final review

Se verificó consistencia documental en arquitectura SPA, cookie HttpOnly, CSRF, bootstrap y expiración de sesión, cambio de tenant y limpieza de cache, decimals string, permissions, server state, forms, contratos de paginación, performance y accesibilidad. También se revisaron store global innecesario, abstracciones prematuras, duplicación de reglas backend y precisión de las reglas para desarrollo asistido por Codex.

## Technical references

- React, “You Might Not Need an Effect”.
- React Router, “Picking a Mode”.
- TanStack Query, documentación oficial v5.
- TanStack Table, “Overview”, “Table State” y “Sorting Guide”.
- Vite, “Features”.
- Zod, documentación oficial.
- W3C, “Web Content Accessibility Guidelines (WCAG) 2.2”.
