# DECISIONS.md

ADRs cortos. Cada entrada: qué se decidió, por qué, qué se descartó.

## Patrimonio: separar `SavingsHolding`, `InvestmentAsset`, `InvestmentHolding` y `AssetPrice`

**Decisión:** una inversión nunca se modela como si fuera simplemente una moneda o un
ahorro. Cuatro entidades separadas: `SavingsHolding` (plata que no pasa por el ledger),
`InvestmentAsset` (el instrumento — SPY, un CEDEAR, Bitcoin), `InvestmentHolding` (cuánto
tiene el usuario de ese activo) y `AssetPrice` (el precio del activo en una fecha,
**append-only** — cada actualización inserta una fila nueva, nunca pisa la anterior).

**Por qué:** el precio de un activo cambia todos los días y es independiente de cuánto
tiene el usuario; mezclar "cantidad" y "precio" en una sola entidad obligaría a reescribir
la posición completa cada vez que se actualiza una cotización, y perdería el historial de
precios en el proceso. Separar `AssetPrice` como su propia tabla append-only da el
historial gratis (necesario para poder reconstruir "patrimonio de enero" más adelante) y
deja que una carga manual de precio y un fetch automático (Etapa de cotizaciones
automáticas) convivan sin caso especial: la fila más reciente por fecha gana, sin importar
su `source`.

**Costo aceptado:** más tablas y un join extra (activo → última fila de precio → posición)
para calcular una valuación, en vez de un único registro "inversión" con todo adentro. Se
resuelve en una sola función de dominio (`domain/networth/valuation.ts:valuateNetWorth`),
así que el costo no se repite en cada componente que necesita el total.

**Cantidades como enteros escalados, nunca float:** `InvestmentHolding.quantity` es un
`Quantity` (`domain/decimal/quantity.ts`) — entero escalado por `1e8` (8 decimales,
suficiente para un satoshi), mismo espíritu que `Minor` para plata. Una cantidad
fraccionaria de un activo (`0.00123456 BTC`) alimenta directamente un cálculo monetario
(`quantity × precio`), así que aplica la misma regla de "Reglas financieras" en
`CLAUDE.md` que prohíbe float para cualquier cifra que termine en una cuenta de plata.
`domain/decimal/quantity.ts:valuePosition(quantity, price)` es la única función que hace
esa multiplicación, con un guard explícito contra overflow de `Number.MAX_SAFE_INTEGER` en
vez de dejar que el resultado se corrompa en silencio.

## Cotizaciones: extender `ExchangeRate`, no un modelo aparte — automáticas, opt-in

**Decisión:** en vez de crear un modelo de "cotización" paralelo para patrimonio, se
extendió la `ExchangeRate` que ya usan Dashboard/Reportes con tres campos opcionales:
`profile` (qué referencia — oficial/MEP/CCL/blue/cripto/mayorista/tarjeta/una propia),
`source` (`'manual' | 'automatic'`) y `capturedAt`. `Settings.autoQuotesEnabled` (default
**`false`**) es el opt-in explícito para completar tasas automáticamente; sin activarlo,
la app hace exactamente cero requests de red, igual que siempre.

**Por qué:** una segunda fuente de verdad para "cuánto vale un USD" — una para
Dashboard/Reportes, otra para Patrimonio — arriesgaba mostrar dos números distintos para
la misma pregunta según qué pantalla mirás. Extender la entidad existente hace que
`resolveRate`/`convert` (`domain/currency/rates.ts`) sigan siendo el único lugar que
resuelve una tasa, para todo el consumidor que exista hoy o después.

`resolveRate` ahora también triangula por USD como último recurso (sólo cuando no hay
tasa directa ni recíproca para el par pedido) y prefiere el `profile` pedido, cayendo a
una tasa sin `profile` si no hay match — nunca a la de otra referencia distinta. Ambos
cambios son estrictamente aditivos: un caller que nunca pasa `profile` ni depende de
triangulación (todo el código anterior a esta feature) se comporta exactamente igual.

**Costo aceptado:** el schema de `ExchangeRate` crece con campos que sólo tienen sentido
si se activan las cotizaciones automáticas (Etapa siguiente) — se aceptó el campo
"muerto" por ahora a cambio de no tener que migrar el schema otra vez cuando se conecten
los proveedores.

**Actualización (Etapa 6C):** los proveedores ya están conectados — ver "Cotizaciones
automáticas: proveedores, frescura y fallos" abajo para el detalle de qué se llama, cómo
se cachea, y cómo se degrada ante un fallo.

## Cotizaciones automáticas: proveedores, frescura y fallos

**Decisión:** tres proveedores, cada uno verificado a mano (request real, no sólo su
documentación) antes de conectarlo — ver `src/features/quotes/providers/`:

- **Frankfurter** (`frankfurter.ts`) para EUR/USD — gratis, sin key, CORS habilitado,
  tasas de referencia del BCE.
- **dolarapi.com** (`dolarApi.ts`) para USD/ARS por referencia (oficial/blue/MEP/CCL/
  mayorista/cripto/tarjeta) — gratis, sin key, CORS habilitado, es la única fuente que
  distingue esas referencias en vez de dar "un" dólar. Usa el valor de **venta** (lo que
  cuesta comprar USD) como cifra representativa de cada referencia — es el número más
  cercano a "cuánto vale un dólar" para valuar patrimonio en ARS.
- **CoinGecko** (`coinGecko.ts`) sólo para `InvestmentAsset` de tipo `crypto` con
  `priceMode: 'auto'` y un `externalId` cargado (el id de CoinGecko, ej. `"bitcoin"`,
  no el símbolo) — gratis, sin key, CORS habilitado. Acciones/ETFs/bonos/FCI siguen
  manuales: no existe un proveedor gratuito, sin key y con CORS habilitado para esos
  instrumentos (ver ADR "Modelo de dominio para inversiones").

**Actualización:** CEDEARs dejó de estar en esa lista de "sin proveedor" — ver ADR
"Cotizaciones automáticas de CEDEARs (data912)" más abajo para el cuarto proveedor.

Un `InvestmentAsset` nuevo siempre arranca en `priceMode: 'manual'` — el switch "auto"
sólo aparece en el formulario cuando el tipo es `crypto` o `cedear`, y sólo tiene efecto real con
un `externalId` no vacío; cualquier otra combinación (tipo distinto, switch prendido sin
id) cae a manual sin avisar con un error, porque no es un estado inválido, simplemente
"todavía no configuraste el id".

**Frescura:** una cotización se considera vencida a las 12 horas
(`features/quotes/service.ts:STALE_HOURS`/`isStale`). Al abrir la app, si
`Settings.autoQuotesEnabled` está prendido y hay algo vencido (o nunca se actualizó),
`refreshQuotes()` corre en silencio — sin toast propio, a diferencia de
`materializeDue()` — porque es un efecto de fondo que no necesita interrumpir al usuario;
el tab Cotizaciones ya muestra "última actualización" de forma reactiva para quien quiera
mirarlo. El botón "Actualizar ahora" siempre está disponible y sí muestra un toast con el
resultado, porque ahí el usuario lo pidió explícitamente.

**Fallos:** cada proveedor se llama en paralelo (`Promise.all`) y ninguno tira — un
fallo de red, timeout (`AbortSignal.timeout(8000)`) o una respuesta con forma inesperada
(validada con Zod) hacen que esa función devuelva `undefined`/`[]` en vez de propagar el
error. `refreshQuotes()` nunca escribe nada por un proveedor que falló, y nunca toca ni
borra una cotización ya cargada — la última válida en IndexedDB sigue siendo la que se
usa. El resumen de qué proveedor falló se expone (`RefreshResult.failed`) para que la UI
avise, en vez de fallar en silencio total.

**Costo aceptado:** `ExchangeRate`/`AssetPrice` son append-only (ya decidido en Etapas
6A/6B) — cada refresh automático inserta filas nuevas en vez de actualizar la existente,
así que abrir la app varias veces en un día con la cotización ya vencida por poco puede
acumular filas de más. Aceptable para el volumen de un usuario único, y es el mismo costo
ya aceptado para una carga manual repetida.

**Detalle no obvio (encontrado en revisión, corregido antes de mergear):** un precio de
CoinGecko es un `number` de JS crudo, no texto tipeado por un usuario — pasarlo por
`parseAmount(String(precio), moneda)` (pensado para texto locale-loose) es un error real:
para cualquier precio por debajo de ~1e-6 (común en criptos de baja capitalización),
`String()` produce notación científica (`"1.2e-7"`), que `parseAmount` interpreta mal
(la regex de limpieza descarta la `"e"` pero conserva los dígitos, así que "1.2e-7" se
lee como si fuera "1.27") — corrompe el precio en varios órdenes de magnitud sin tirar
ningún error. `domain/money/money.ts:moneyFromNumber(valor, moneda)` reemplaza ese paso:
convierte el `number` directo a `Minor` con `roundHalfUp`, sin pasar por texto en ningún
momento. Regla general: `parseAmount` es sólo para texto que tipeó un usuario;
`moneyFromNumber` es para un `number` que ya viene de código (una API, un cálculo).

**Detalle no obvio (mismo hallazgo):** `refreshQuotes()` mapeaba cotizaciones cripto a
activos con un `Map` indexado por `externalId` — si dos `InvestmentAsset` distintos
comparten el mismo id de CoinGecko (caso real: el mismo activo separado en dos holdings,
ej. "en el exchange" y "en cold storage"), el `Map` sólo se quedaba con el último,
dejando al otro activo "auto" en apariencia pero sin actualizarse nunca, sin avisar en
`RefreshResult.failed`. Se corrigió iterando sobre los activos elegibles (no sobre las
cotizaciones recibidas) y buscando la cotización de cada uno — así todos los activos que
comparten `externalId` reciben su propia fila de precio.

**Detalle no obvio (mismo hallazgo):** `domain/currency/rates.ts:latestOnOrBefore`
desempataba dos tasas del mismo `date` quedándose con la primera encontrada — en la
práctica, la más vieja (Dexie itera por `id`, y `generateId()` es tipo ULID con
timestamp al inicio, así que el orden de iteración es cronológico ascendente). Esto
contradecía la garantía documentada de que "una carga manual posterior a un fetch
automático la reemplaza sin mecanismo especial": con refresh automático corriendo cada
≤12h, dos tasas del mismo día dejaron de ser un caso raro. Se agregó desempate por
`capturedAt` (timestamp completo) cuando `date` coincide — ver la entidad `ExchangeRate`
en `docs/DATA_MODEL.md`.

## Absorber `/ajustes/tasas` en Patrimonio → Cotizaciones

**Decisión:** la feature `features/exchangeRates/` (página, formulario, hook) se borró
por completo; su ruta (`/ajustes/tasas`) redirige a `/patrimonio`. Cargar/ver/borrar una
`ExchangeRate` a mano ahora vive en la pestaña Cotizaciones, con el campo `profile`
agregado al formulario.

**Por qué:** con cotizaciones automáticas, la carga manual de tasas y su fuente
automática son la misma pantalla por necesidad — mostrar "última actualización",
elegir qué referencia usar para valuar, y cargar una tasa a mano son todas decisiones
sobre el mismo dato, y tenerlas separadas en dos rutas (`/ajustes/tasas` viejo,
`/patrimonio` nuevo) hubiera significado mantener dos UIs para la misma tabla. El
`database/repositories/exchangeRates.repo.ts` (la capa que sí importan Reportes/
Presupuestos) no se tocó — sólo se movió/eliminó la UI de un único feature.

**Costo aceptado:** un bookmark o link viejo a `/ajustes/tasas` cae en Patrimonio
directo a la pestaña Resumen, no a Cotizaciones (el tab activo es estado de Zustand, no
la URL — mismo límite que ya tienen `/planes` o `/patrimonio` mismo con sus propios
tabs). Un clic más para llegar a Cotizaciones es un costo menor frente a duplicar la UI.

## Import de CSV: una categoría por lote, duplicados destildados no bloqueados

**Decisión:** `src/features/csvImport/` importa un extracto bancario a una sola cuenta
por vez, con **una** categoría de gasto y **una** de ingreso elegidas para todo el lote
(el `kind` de cada fila sale del signo del monto o de qué columna — débito/crédito —
tiene valor). Las filas que parecen duplicadas de movimientos ya cargados (mismo
día+monto+descripción normalizada, en esa cuenta) se detectan y vienen destildadas por
defecto en la vista previa, pero el usuario puede tildarlas igual — nunca se bloquean.

**Por qué:** categorizar por texto (matching de palabras clave, o peor, alguna
heurística más compleja) es una feature bastante más grande, con riesgo real de
categorizar mal en silencio — categorías incorrectas son más difíciles de notar que
duplicados, que al menos son visibles y revisables en la vista previa antes de
confirmar. Para la primera versión, una categoría por lote más recategorizar a mano lo
que haga falta desde Movimientos es más simple y más seguro que una heurística que se
equivoca en un caso que el usuario no llega a revisar.

**Costo aceptado:** un extracto con muchas categorías reales requiere recategorizar
manualmente después de importar. Queda en el backlog una versión con reglas de
categorización configurables si en la práctica esto molesta.

**Detalle técnico:** el parser (`papaparse`, dependencia nueva — corre 100% local, cero
red) autodetecta el delimitador, pero el **formato de fecha nunca se autodetecta** —
`23/08/2026` es genuinamente ambiguo entre DD/MM y MM/DD sin más contexto, así que el
usuario lo elige explícito en el mapeo en vez de una heurística que puede acertar la
mayoría de las veces y arruinar silenciosamente el resto.

## Ledger de partida doble ligera en vez de transacciones tipadas simples

**Decisión:** toda transacción es una lista de `Posting`s con signo que suman cero, en vez
de un registro con `type: 'income'|'expense'|'transfer'` + `accountId` + `amount` +
`toAccountId?`.

**Por qué:** con transacciones tipadas, una transferencia (y peor, una transferencia
cross-currency) es un caso especial en cada cálculo de balance, cada reporte y cada
validación. Con postings, "balance de una cuenta" es siempre la misma query
(`sum(postings where accountId = X)`) sin importar si el movimiento fue un gasto, un
ingreso o una transferencia.

**Costo aceptado:** los formularios tienen que traducir la intención del usuario ("gasté
$X en Y") a postings — por eso existen los builders (`buildExpense`, `buildIncome`,
`buildTransfer`, `buildFxTransfer`) en `domain/ledger`, para que ese mapeo se escriba una
sola vez.

## Enteros en unidades menores, nunca float

**Decisión:** todo importe es un entero (centavos), tipado como `Minor` (branded type).

**Por qué:** es el estándar de cualquier sistema financiero serio — el punto flotante
binario no puede representar exactamente la mayoría de los valores decimales
(`0.1 + 0.2 !== 0.3` en JS), lo que eventualmente produce diferencias de un centavo que
son muy difíciles de rastrear. Un branded type hace que sea un error de compilación pasar
un `number` crudo donde se espera un `Minor`.

## Reparto por resto mayor (`allocate`) para cuotas y splits

**Decisión:** dividir un total entre N partes usa el método del resto mayor: se calculan
los pisos de cada parte proporcional y el resto se reparte de a una unidad a las partes
con mayor resto fraccionario.

**Por qué:** es el único método simple que garantiza `sum(partes) === total` siempre. Redondear
cada parte por separado (ej. `Math.round(total/n)` repetido) puede perder o inventar una
unidad menor cuando `total` no es múltiplo de `n`.

## Recurrentes y cuotas como planes + instancias materializadas

**Decisión:** un `RecurringPlan`/`InstallmentPlan` no es una transacción; genera
`Transaction`s reales (con `sourcePlanId`) cuando corresponde, en vez de que los reportes
calculen las ocurrencias al vuelo cada vez.

**Por qué:** permite editar o marcar como pagada una ocurrencia puntual sin inventar un
sistema de excepciones sobre una regla recurrente, y mantiene el historial inmutable — si
se cambia la regla de un plan a futuro, las transacciones ya materializadas no se
recalculan retroactivamente.

**Costo aceptado:** más filas en la base que un modelo "todo virtual". Aceptable para el
volumen de datos de un usuario único.

## Borrar un plan nunca borra plata que ya pasó

**Decisión:** borrar un `RecurringPlan` deja intactas sus transacciones ya
materializadas (siempre `confirmed`); borrar un `InstallmentPlan` borra sólo sus cuotas
todavía `projected` y conserva las `confirmed`.

**Por qué:** una transacción `confirmed` es historial real — ya movió (o va a mover, en
el caso de una cuota futura ya vencida y confirmada) el balance de una cuenta, y borrarla
sin que el usuario edite esa transacción puntualmente sería un cambio de plata silencioso.
Una cuota `projected` en cambio es sólo una previsión: nunca afectó ningún balance ni
reporte (ambos filtran por `status === 'confirmed'` desde la Etapa 0/3), así que borrarla
junto con el plan que la generó es simplemente descartar una previsión que dejó de ser
válida.

**Costo aceptado:** el usuario que quiere "deshacer" una cuota o recurrente ya confirmado
tiene que borrar esa transacción puntual desde Movimientos, no desde el plan — mismo
patrón ya establecido para editar una ocurrencia sin afectar el resto (ver "Recurrentes y
cuotas como planes + instancias materializadas" arriba).

**Actualización:** este "nunca" tiene una única excepción, explícita y opt-in — ver
"Borrar un recurrente: opción explícita para borrar también su historial" más abajo.

## Borrar un recurrente: opción explícita para borrar también su historial

**Decisión:** `deleteRecurringPlan` (`database/repositories/recurringPlans.repo.ts`)
acepta `{ deleteGeneratedTransactions: true }`, que borra también toda transacción
`confirmed` que ese plan haya generado (`deleteAllBySourcePlanId`, junto a la
`deleteProjectedBySourcePlanId` ya existente para cuotas). Sigue sin ser el default —
`PlansPage` sólo ofrece el checkbox ("Borrar también los N movimientos que ya generó")
cuando el plan tiene algo generado, y arranca destildado.

**Por qué:** el "nunca" original (ver ADR de arriba) asumía que la única forma de
"deshacer" un recurrente era borrar sus transacciones una por una desde Movimientos —
tedioso para un recurrente creado por error con varios meses ya materializados. El
usuario pidió explícitamente una forma de deshacerlo del todo, historial incluido, sin
convertir eso en el comportamiento por default (que sigue protegiendo contra el borrado
accidental de plata real).

**Costo aceptado:** es irreversible (no hay soft-delete ni papelera). Ventana de carrera
angosta y ya existente en otra forma: si `materializeDue()` corre en otra pestaña casi en
simultáneo con este borrado, una transacción recién materializada podría no alcanzar a
ser capturada por el scan de `deleteAllBySourcePlanId` y quedar con un `sourcePlanId`
huérfano — el mismo tipo de referencia huérfana que ya puede darse hoy en el camino
default (plan borrado, `sourcePlanId` apuntando a un plan que ya no existe). No rompe la
partida doble (esa transacción sigue teniendo sus propios postings balanceados), sólo
significa que un "borrar todo" muy mal sincronizado con la materialización automática
puede dejar, en el peor caso, una transacción suelta sin avisar en la UI.

## Editar un recurrente: todo el template/regla; una compra en cuotas: sólo metadata

**Decisión:** un `RecurringPlan` se puede editar por completo (descripción, cuenta,
categoría, monto, frecuencia, fechas) — el cambio rige sólo para lo que se materialice de
ahí en adelante, nunca reescribe transacciones ya generadas. Un `InstallmentPlan` en
cambio sólo permite editar descripción, cuenta y categoría — el monto total, la cantidad
de cuotas y las fechas quedan fijos después de crear la compra.

**Por qué:** un recurrente genera sus transacciones de a una, con el tiempo
(`materializeDue`), así que cambiar el template/regla es seguro — nunca toca lo ya
materializado, sólo lo que todavía no existe. Una compra en cuotas en cambio genera las N
transacciones completas de una sola vez al crearla (algunas ya `confirmed`), y
`listInstallmentPlansWithProgress` calcula cuánto ya se pagó leyendo
`InstallmentPlan.scheduleCache`, no las transacciones mismas — si se permitiera editar
`totalAmount`/`count` habría que recalcular ese reparto con `allocate()`, pero las cuotas
`confirmed` son historial inmutable (ver "Borrar un plan nunca borra plata que ya pasó"
arriba) y no se pueden recalcular con ellas. Un `scheduleCache` nuevo que no coincida con
lo que esas transacciones ya cobraron rompería silenciosamente ese cálculo de progreso.
Description/cuenta/categoría en cambio no participan de ningún cálculo monetario, así que
son seguras de editar — el cambio se propaga sólo a las cuotas todavía `projected`
(reescritas in situ preservando monto/fecha/índice), nunca a las `confirmed`, mismo
patrón que borrar un plan.

**Costo aceptado:** para cambiar el monto o la cantidad de cuotas de una compra hay que
borrarla y cargarla de nuevo — no hay forma de "corregir" ese número en el lugar.

## Cifrado del backup: WebCrypto nativo, opt-in, sin recuperación

**Decisión:** el archivo `.finance` puede cifrarse opcionalmente con una contraseña
(AES-256-GCM + PBKDF2-SHA256 vía `crypto.subtle`, `src/features/backups/encryption.ts`).
Nunca es el comportamiento por defecto — el usuario tiene que activar un switch a
propósito y confirmar la contraseña. No hay ningún mecanismo de recuperación: perder la
contraseña deja el backup inservible para siempre.

**Por qué:** el `.finance` es la única persistencia que sale del dispositivo (la
IndexedDB local ya está protegida por el sandbox del navegador/OS) — es el único punto
donde cifrado agrega algo. `crypto.subtle` es una API nativa del navegador, así que esto
no agrega ninguna dependencia nueva, consistente con la política de dependencias del
repo. GCM es cifrado autenticado: una contraseña incorrecta y un archivo corrupto tiran
la misma excepción indistinguible — es deliberado (evita un oráculo de padding), así que
la UI muestra un único mensaje para ambos casos en vez de intentar diferenciarlos.

**Costo aceptado:** sin recuperación, un typo en la contraseña del día que se cifró un
backup lo vuelve inútil — por eso el formulario de export pide la contraseña dos veces.
No agregar un "hint" de contraseña ni ningún dato derivado más débil (reduciría la
seguridad real a cambio de una conveniencia que no vale la pena para este caso de uso).

## Merge de backup: la base local siempre gana

**Decisión:** el modo merge del import (`importBackup(file, { mode: 'merge' })`) sólo
agrega filas que no existen localmente — nunca sobrescribe ni borra una entidad que ya
está en el dispositivo, aunque el archivo traiga una versión distinta con la misma ID.

**Por qué:** es la única política que no corre riesgo de pisar una edición reciente con
datos viejos del archivo, sin necesitar una UI de resolución de conflictos (que es una
feature bastante más grande). Como consecuencia directa, re-importar el mismo backup (o
uno superpuesto) en modo merge es idempotente — no duplica nada, porque todo lo que ya
existe se salta. Esto también resuelve `Settings` sin caso especial: como esa fila
(`id: 'singleton'`) casi siempre existe ya, la regla general la deja intacta sola.

**Costo aceptado:** dos cuentas creadas independientemente en cada dispositivo (ej. dos
"Banco" con IDs distintas) quedan duplicadas visualmente después de un merge — no hay
deduplicación por nombre. Resolverlo bien requeriría matching difuso y una UI de
conflictos; para el caso de uso real (consolidar dos dispositivos una sola vez, no
sincronizarlos en curso — ver "No-objetivos" en `docs/PRODUCT.md`), el usuario
archivando la cuenta duplicada a mano es más barato que construir esa feature.

**Detalle no obvio:** "unión por ID" no alcanza para `transactions` con `sourcePlanId` —
un `RecurringPlan` que ya existía en ambos dispositivos antes de separarse materializa la
misma ocurrencia calendario con un `id` de transacción *distinto* en cada uno
(`generateId()` es aleatorio, no derivado de la fecha/plan). Dedupear sólo por `id`
duplicaría silenciosamente el monto en el balance de la cuenta — el caso de uso central
que esta feature dice resolver. Por eso `transactions` también dedupe por el par
`(sourcePlanId, occurrenceIndex)` cuando está presente, además de por `id`. Además, el
merge repara `RecurringPlan.lastMaterializedDate` después de agregar transacciones — sin
esto, `materializeDue()` duplicaría cualquier ocurrencia traída desde otro dispositivo
cuya fecha sea posterior al watermark local, en la próxima apertura de la app. Ver
`docs/DATA_MODEL.md` "Modo merge" para el detalle completo.

**Detalle no obvio:** el merge repara `RecurringPlan.lastMaterializedDate` después de
agregar transacciones — sin esto, `materializeDue()` duplicaría cualquier ocurrencia
traída desde otro dispositivo cuya fecha sea posterior al watermark local, en la próxima
apertura de la app. Ver `docs/DATA_MODEL.md` "Modo merge" para el detalle completo.

## Cuenta con moneda fija + tasas manuales, no conversión automática

**Decisión:** cada `Account` tiene una `currency` fija; las tasas de cambio
(`ExchangeRate`) las carga el usuario a mano, con fecha. No hay integración con ninguna
API de cotizaciones.

**Por qué:** privacidad (cero requests de red, ver `CLAUDE.md`) y simplicidad — el usuario
en Argentina ya sabe qué tasa usó para una operación real (oficial, blue, tarjeta, etc.),
que casi nunca coincide con "la" cotización de una API.

**Actualización (Patrimonio):** "no hay integración con ninguna API" dejó de ser
absoluto — ver "Cotizaciones: extender `ExchangeRate`, no un modelo aparte" abajo. La
cuenta con moneda fija y la carga manual como comportamiento por defecto siguen intactas;
lo que cambió es que ahora existe una opción opt-in (apagada por defecto) para completar
`ExchangeRate` con proveedores automáticos, siempre encima de la misma entidad.

## Dexie sobre IndexedDB crudo

**Decisión:** usar Dexie.js como wrapper de IndexedDB en vez de la API nativa.

**Por qué:** la API nativa de IndexedDB es de bajo nivel y muy verbosa para transacciones,
índices compuestos y queries; Dexie da una API basada en promesas, `useLiveQuery` para
reactividad en React, y sigue siendo 100% local (no es un backend-as-a-service).

## Backup versionado desde el día 1, separado del schema de Dexie

**Decisión:** el formato del archivo `.finance` tiene su propio número de versión,
independiente de las versiones de `db.version()` de Dexie.

**Por qué:** son ciclos de vida distintos. El schema de Dexie puede cambiar en formas que
no ameritan un cambio en el formato de backup (ej. agregar un índice), y viceversa, el
formato de backup podría necesitar cambiar por razones de compatibilidad externa sin que
cambie el schema interno.

## Local-first sin autenticación

**Decisión:** no hay login, cuentas de usuario, ni ningún concepto de identidad — el
dispositivo es el perímetro.

**Por qué:** es un requisito explícito del producto (ver `docs/PRODUCT.md`), no una
omisión temporal. Agregar autenticación implicaría un backend, que es exactamente lo que
este proyecto evita.

## Un feature puede importar el `service.ts`/hooks de otro, nunca sus componentes

**Decisión:** `features/dashboard` importa directamente `getMonthSummary` desde
`features/reports/` y `getNetWorthSummary` desde `features/networth/`, en vez de duplicar
esa lógica. En cambio, en Etapas anteriores se duplicó deliberadamente un hook trivial de
una sola línea (`useAccounts`, wrapper de `accountsRepo.listAccountsWithBalances`) entre
`features/accounts` y `features/transactions`.

**Por qué:** la tabla de capas de `CLAUDE.md` prohíbe textualmente que un feature importe
"otros `features/*/components` internos" — no menciona `service.ts` ni `hooks/`. Para un
wrapper trivial de una sola función de repository, duplicar es más barato que la
dependencia cruzada. Pero `getMonthSummary`/`getNetWorthSummary` no son triviales: hacen
conversión de moneda con manejo de tasas faltantes (`missingRateCount`), y esa lógica
sería costosa y riesgosa de mantener en dos lugares (un fix tendría que aplicarse dos
veces). El componente compartido `MissingRateBanner` que ambas páginas usan sí vive en
`src/components/` — ahí es donde corresponde un componente puramente presentacional sin
lógica de negocio, no en un feature.

(Nota histórica: hasta el fix "Dashboard consolidado con Patrimonio", `features/dashboard`
importaba `getCurrentNetWorth` de `features/reports` — una función previa a Etapa 6 que
nunca aprendió sobre Ahorros/Inversiones. Se reemplazó por `getNetWorthSummary`;
`getCurrentNetWorth` y su hook quedaron sin ningún caller y se borraron.)

**Regla práctica:** un componente de UI nunca cruza de un feature a otro (usar
`src/components/` si hace falta compartirlo); un `service.ts`/hook puede cruzar cuando
duplicarlo costaría más que la dependencia — evaluar caso por caso, no por defecto.

## `DateField` propio en vez de `<input type="date">`, con `react-day-picker`

**Decisión:** ningún campo de fecha usa el `<input type="date">` nativo. Se reemplazó en
todos lados por `src/components/DateField.tsx`, un Popover con un Calendar propio
(`src/components/ui/calendar.tsx`, `src/components/ui/popover.tsx`), agregando
`react-day-picker` como dependencia nueva.

**Por qué:** el formato en que un `<input type="date">` *muestra* la fecha lo decide el
navegador según su propio idioma configurado — no el `lang` de la página, no ningún CSS.
En la práctica esto mostraba `mm/dd/aaaa` (inglés de EE.UU.) en una app 100% en español,
incluyendo un caso visible donde el placeholder salía literalmente sin traducir
("mm/dd/yyyy"). No hay forma de forzar el formato del input nativo; la única solución real
es no usarlo.

**Por qué `react-day-picker` y no otra librería o un calendario hecho a mano:** ya son
dependencias del proyecto tanto `date-fns` (su motor de fechas) como `radix-ui` (de ahí
sale el primitivo `Popover`), así que sumar `react-day-picker` fue la superficie nueva más
chica posible — no hizo falta agregar ninguna otra dependencia de UI, y es la librería que
el propio ecosistema shadcn/ui usa para esto. Se descartó escribir una grilla de calendario
a mano: reinventar navegación de mes, foco por teclado y estados de accesibilidad de un
datepicker no se justifica cuando ya existe una librería madura y mantenida para
exactamente eso.

**Costo aceptado:** es el primer uso de Popover/Calendar en el repo. En vez de repetir la
receta completa de shadcn (pisar el className de cada subcomponente a mano), el tema se
resuelve mapeando las variables CSS propias de `react-day-picker` (`--rdp-*`, documentadas
en su `style.css`) a los tokens de la app (`--primary`, `--radius-md`, etc.) — mucho menos
código, mismo resultado visual. Un detalle no obvio para quien reuse `DateField`: elegir un
día cierra el popover pisando el estado `open` directo, no a través del `onOpenChange` de
Radix, así que `field.onBlur` de react-hook-form no se dispara al elegir una fecha (sí al
cerrar sin elegir). Hoy no importa porque ningún formulario usa `mode: 'onBlur'`.

## Evolución del patrimonio: cantidades de hoy, precios de cada mes

**Decisión:** el gráfico "Evolución del patrimonio" de Reportes (`getNetWorthHistory`)
suma Cuentas + Ahorros + Inversiones en cada punto histórico. Cuentas usa el balance real
de esa fecha (reconstruible desde el ledger, `accountsRepo.listAccountsWithBalances(asOfDate)`).
Ahorros e Inversiones usan la cantidad/monto **actual** de cada `SavingsHolding`/
`InvestmentHolding` — no la que tenían en esa fecha — pero revaluada con la tasa de cambio
y el precio de activo que estaban vigentes en cada mes (`resolveRate`/`latestAssetPrices`,
ambos ya "más reciente ≤ fecha").

**Por qué:** a diferencia de una cuenta, `SavingsHolding.amount` e `InvestmentHolding.quantity`
no tienen ningún historial — son un valor de "ahora mismo", sin ledger ni versión anterior.
No hay forma de saber cuánto ahorro o cuántas unidades de un activo tenía el usuario en
marzo sin agregar un sistema de snapshots nuevo (que además arrancaría vacío: los meses
pasados a la fecha de implementación seguirían sin dato real). Se optó por la aproximación
más simple posible en vez de no mostrar nada o mentir con un total sólo-cuentas bajo un
título que promete "patrimonio": usar la cantidad de hoy y revaluarla con precios/tasas que
sí son históricos reales. El resultado es "cuánto valdría hoy mi cartera actual si la
hubiera tenido en cada mes pasado", no "cuánto tenía realmente" — la UI lo aclara con una
nota debajo del gráfico.

**Costo aceptado:** si el usuario compró/vendió una inversión o cambió su ahorro a mitad
de camino, los puntos anteriores a ese cambio quedan sobre/subestimados (asumen que ya
tenía o todavía tenía lo que tiene hoy). Es una aproximación, no un historial exacto — se
prefirió eso a la alternativa de construir un sistema de snapshots mensuales reales, que es
mucho más trabajo para un beneficio que sólo empieza a acumularse desde que se implementa
(el pasado ya ocurrido nunca tendría datos reales de todos modos).

**De paso:** `getMonthSummary`/`getExpenseByCategoryInRange` (mismo archivo, misma página
Reportes) no le pasaban `settings.rateProfile` a `convert()` — sólo `getNetWorthHistory`
lo hacía a través de `valuateNetWorth`. Se corrigió para que las tres funciones usen el
mismo `profile`; si no, con un `rateProfile` configurado (ej. "blue"), el resumen mensual y
el gráfico de patrimonio de la misma página podían convertir la misma fecha con tasas
distintas.

## Informe mensual: PDF vía el diálogo de impresión del navegador

**Decisión:** el informe mensual (`getMonthlyReport` en `features/reports/service.ts`,
ruta `/reportes/informe/:month`) es una página HTML normal con hoja de estilos de
impresión, deliberadamente **fuera de `AppLayout`** (sin sidebar ni bottom nav). El
usuario lo exporta con "Guardar como PDF" del propio diálogo de impresión del navegador
(`window.print()`). Cero dependencias nuevas.

**Por qué:** sigue siendo 100% cliente (CLAUDE.md "Privacidad" — ni un request), el PDF
resultante tiene texto vectorial seleccionable/buscable en vez de una imagen, y el flujo
de impresión nativo ya existe igual en desktop y en el share sheet de iOS/Android — no
hay nada nuevo que aprender ni mantener.

**Descartado:** rasterizar la vista a PNG con `html2canvas`/`dom-to-image` (dependencia
pesada, salida borrosa, texto no seleccionable, y frágil con fuentes/gradientes — ver
abajo por qué ni siquiera el propio `ExpenseByCategoryChart` se reusó acá); generar el
PDF a mano con `jsPDF`/`pdfmake` (dependencia nueva + reimplementar el layout entero en
coordenadas, duplicando lo que CSS ya hace bien); armar el informe en el servidor (viola
local-first, no hay servidor).

**Sub-decisiones:**
- El documento usa **colores literales** (`bg-white`, `text-neutral-900`, etc.), nunca
  los tokens semánticos de tema de la app (`bg-background`, `text-foreground`). En modo
  oscuro `body` hereda `text-foreground` casi blanco, y los navegadores descartan los
  fondos al imprimir salvo que el usuario tilde "gráficos de fondo" — un informe con
  tokens de tema imprimiría texto casi blanco sobre papel blanco. Es un documento
  siempre claro, como un extracto/factura, independiente del tema activo de la app
  (verificado a mano: se ve idéntico con el tema de la app en claro y en oscuro).
- El desglose de "Gasto por categoría" es una **tabla HTML simple**, no el
  `ExpenseByCategoryChart` de Recharts existente: su SVG se pinta con `var(--primary)`/
  `var(--foreground)`/`var(--border)` (mismo problema de tokens de tema que arriba), y su
  `ResponsiveContainer` reobserva el tamaño durante el layout de impresión — una fuente
  extra de fragilidad que una tabla no tiene. La tabla además muestra el detalle exacto
  (categoría, %, importe) que un extracto necesita.
- `viewport-fit=cover`/`safe-area-inset-*` no aplican acá — esta ruta no comparte layout
  con `AppLayout`, así que no hereda el ajuste de safe-area de la Etapa PWA.

**Costo aceptado:** no hay control fino de encabezado/pie de página ni de saltos de
página más allá de lo que permite CSS (`@page`, `break-inside-avoid`), y la salida varía
levemente entre navegadores (Chrome/Safari/Firefox difieren en su diálogo de impresión).
No es posible verificar el PDF real en tests automatizados — el e2e (`e2e/monthly-report.spec.ts`)
sólo confirma, con `page.emulateMedia({ media: 'print' })`, que los estilos de impresión
efectivamente ocultan la barra de acciones de sólo-pantalla.

## Ahorro e Inversiones deja de incluir Cuentas

**Decisión:** `/patrimonio` se renombra a "Ahorro e Inversiones" (nav, `PageHeader`) y su
pestaña Resumen (total + gráfico de Distribución) deja de sumar Cuentas — pasa a ser
sólo Ahorros + Inversiones. `features/networth/service.ts:getNetWorthSummary` llama a
`domain/networth:valuateNetWorth` con `accounts: []` en vez de consultar
`accountsRepo.listAccountsWithBalances()`; el resto de la función (savings, positions,
rates) no cambia. El Dashboard usa esa misma función para su tarjeta "Ahorro e
inversiones", así que los dos números siguen coincidiendo — lo que cambió es qué
representan, no la garantía de "misma fuente, mismo número" establecida en "Post-6C —
Dashboard consolidado con Patrimonio" (`docs/ROADMAP.md`).

**Por qué:** pedido directo del usuario — el número de "patrimonio" en el Dashboard no le
resultaba útil porque mezclaba sus cuentas (ya visibles en `/cuentas`) con la plata que
realmente quiere seguir de cerca: ahorros e inversiones. Cuentas y Ahorro e Inversiones
quedan como dos vistas separadas y sin superposición, cada una con su propio total.

**Qué NO cambió:** `domain/networth:valuateNetWorth` sigue siendo capaz de valuar
Cuentas — no se le sacó esa capacidad, sólo se dejó de usarla desde esta feature.
`features/reports/service.ts` (`getMonthlyReport`, `getNetWorthHistory`) llama a
`valuateNetWorth` de forma independiente, con su propia lista de cuentas, así que el
patrimonio consolidado (Cuentas + Ahorros + Inversiones) de Reportes y del informe
mensual exportable no se tocó.

**Descartado:** agregar un campo nuevo tipo `savingsAndInvestments` al lado de `total`
en `NetWorthSummary` y dejar `total`/`byBucket.accounts` como estaban. Innecesario: nada
fuera de esta feature consume `getNetWorthSummary`, así que redefinir directamente qué
significa su `total` es más simple que mantener dos totales en paralelo donde uno queda
sin usar en la práctica.

## "Nueva posición" no ofrece un activo que ya tiene holding

**Decisión:** dos capas, no una sola.

1. **UI** — `InvestmentHoldingFormDialog` recibe un prop nuevo, `availableAssets` (los
   activos sin holding — el mismo `assetsWithoutHolding` que `NetWorthPage.tsx` ya
   calculaba para la fila "Agregar posición"), y usa esa lista en vez de `assets`
   completo para las opciones del selector cuando se está **creando**. `assets` completo
   se sigue pasando y usando tal cual al **editar** (ahí el selector va deshabilitado, y
   necesita poder resolver el activo ya asignado — que por definición no está en
   `assetsWithoutHolding`). El ítem "Nueva posición" del menú "Nuevo" en
   `NetWorthPage.tsx` ahora se deshabilita cuando `assetsWithoutHolding` está vacío, no
   sólo cuando no hay ningún activo cargado.
2. **Repository** — `investments.repo.ts:createInvestmentHolding` corre ahora dentro de
   una `db.transaction('rw', ...)` que cuenta los holdings existentes para ese `assetId`
   y rechaza con un `InvariantError` si ya hay uno. Esto es lo que realmente garantiza la
   invariante — la UI sólo la hace fácil de respetar en el caso feliz.

**Por qué:** antes, el selector de "Nueva posición" listaba TODOS los activos sin
filtrar — nada impedía elegir uno que ya tenía una posición (`investmentHoldings` sólo
indexa `assetId`, no lo restringe a único) y terminar con dos filas separadas para el
mismo activo. El resultado es plata mal representada en todos lados que suman por
posición (Distribución, total de Ahorro e Inversiones, Ganancia/pérdida por posición).
La forma correcta de "comprar más" de un activo que ya tenés es editar esa posición
(sumar la cantidad nueva a la cantidad total y recalcular el costo promedio a mano —
Moneta no promedia automáticamente entre compras, ver `docs/DATA_MODEL.md`); "Nueva
posición" es sólo para un activo que todavía no tiene ninguna.

Encontrado en revisión: la UI sola no cerraba el problema — dos pestañas abiertas al
mismo tiempo (o cualquier otro caller futuro de `createInvestmentHolding`) podían leer
`assetsWithoutHolding` antes de que la otra escribiera, y las dos terminaban creando un
holding para el mismo activo. De ahí el chequeo en el repository, dentro de la
transacción — verificado revirtiendo el `invariant` a mano y viendo fallar el test
nuevo (`refuses a second holding for an asset that already has one`) antes de
restaurarlo.

**Riesgo residual, aceptado a propósito:** el import/merge de un backup escribe
`investmentHoldings` directo a la tabla (`replaceAllTables`/`mergeAllTables` en
`backup.repo.ts`), sin pasar por `createInvestmentHolding` — un backup que ya trae dos
holdings para el mismo activo (por ejemplo, cargado en dos dispositivos antes de este
fix) se importa igual, sin rechazo. Es el mismo costo ya aceptado para cuentas
duplicadas tras un merge (ver "Merge de backup: la base local siempre gana" más abajo):
agregar una validación de integridad en el import que rechace el archivo entero
arriesga volver no-importable un backup viejo y legítimo por un problema menor, a
cambio de cerrar un caso bastante más raro que el de crearlo a mano desde la UI. Si
esto se vuelve un problema real, corregirlo ahí (en `validate.ts`, junto a
`validateLedgerIntegrity`) es el próximo paso — no antes.

**Descartado:** detectar la colisión al enviar el formulario (dejar elegir cualquier
activo y, si ya tiene holding, redirigir a "sumar cantidad" con el promedio ya
recalculado) en vez de sacarlo del selector. Más completo, pero agrega una segunda ruta
de escritura (merge vs. create) y la UI para explicarle al usuario qué está pasando;
sacar el activo del selector es más simple y ya resuelve el caso real. El tracking de
compras por lote (cada compra con su fecha/precio, ganancia realizada exacta sin
promediar a mano) queda en el backlog — es un modelo de datos más grande, sólo
justificado si hace falta precisión fiscal/contable.

## Tracking de inversiones por lote: `InvestmentHolding` pasa a ser un agregado cacheado

**Decisión:** `InvestmentHolding.quantity`/`averageCost` dejan de ser campos editados a
mano y pasan a ser un **agregado cacheado**, recalculado transaccionalmente, de una
entidad nueva: `InvestmentLot` (una fila por compra — cantidad, costo por unidad
opcional, moneda, fecha). Crear/editar/borrar un lote recalcula el holding entero
(`recomputeHoldingAggregate`, `database/repositories/investmentLots.repo.ts`) dentro de
la misma transacción Dexie que escribe el lote — nunca queda una ventana donde el
agregado esté desincronizado de sus lotes. `aggregateLots` (`domain/investments/lots.ts`)
es la función pura que calcula cantidad total y costo promedio ponderado, reusando
`valuePosition`/`add`/`roundHalfUp` de `domain/money`/`domain/decimal` — nada de
aritmética nueva.

**Alcance confirmado con el usuario, explícitamente acotado:** sólo compras. Sin
ganancia realizada ni método contable (FIFO/promedio/etc.) — eso queda en el backlog,
ahora como una entrada más específica que la genérica "tracking por lote" que
reemplaza.

**Corrección post-implementación (encontrada en revisión):** el plan original decía
"vender sigue siendo editar la cantidad del holding a mano, sin cambios" — pero
`InvestmentHoldingFormDialog` (el único lugar donde se editaba `quantity` directo) se
borró junto con `updateInvestmentHoldingFromForm`, así que ese camino ya no existe en la
UI. `investments.repo.ts:updateInvestmentHolding` sigue en el código (con su propio
test), pero sin ningún caller — es la función de bajo nivel que usa
`recomputeHoldingAggregate` internamente, no algo que la UI llame directo. El
equivalente real hoy es **editar hacia abajo la cantidad de una compra existente**
desde "Administrar compras" (`InvestmentLotsDialog`), o borrarla del todo si la venta
cubre esa compra entera — `investmentLotFormSchema.quantity` exige > 0, así que no hay
forma de cargar una "venta" como su propio lote. Sigue siendo manual y sin ganancia
realizada, como decía el alcance original, pero con un costo nuevo no documentado
entonces: con más de un lote para el mismo activo, el usuario tiene que elegir a mano
cuál compra absorbe la reducción — no hay ninguna noción de "cuál se vendió primero".
Aceptable para el alcance confirmado (sólo compras, venta como afterthought manual),
pero si en la práctica esto resulta confuso, un affordance explícito de "reducir
cantidad" a nivel holding (sin atarlo a un lote puntual) queda como posible mejora de
UX, no de modelo de datos.

**Por qué agregado cacheado y no derivar todo al vuelo en cada lectura:** la alternativa
"más pura" — borrar `InvestmentHolding` del todo y calcular cantidad/costo promedio con
un `aggregateLots` en cada lectura — hubiera obligado a tocar cada consumidor existente
de `InvestmentHolding` (`domain/networth/valuation.ts:valuateNetWorth`,
`getInvestmentHoldingsWithDetails`, `NetWorthDistribution`, `InvestmentGainLossChart`,
`getSavingsAndInvestmentsHistory`, `InvestmentRow`) y versionar el backup de forma más
invasiva, a cambio de un beneficio (evitar que el cache se desincronice) que ya se cubre
recalculando siempre dentro de la misma transacción que la escritura del lote que lo
invalida. Mismo patrón ya usado en el repo para `RecurringPlan.lastMaterializedDate` y
para el chequeo de holding duplicado (ver ADR "'Nueva posición' no ofrece un activo que
ya tiene holding" arriba). Con el agregado cacheado, **ningún consumidor existente
cambió una sola línea** — sólo cambió el camino de escritura, de "editar posición" a
"agregar/editar/borrar una compra".

**Migración — todo holding existente nace con un lote heredado:** para que la lógica de
agregado nunca tenga que contemplar "cantidad sin lote" como caso especial, todo
`InvestmentHolding` que ya existía al momento de este cambio recibe un `InvestmentLot`
sintético que replica su `quantity`/`averageCost`/`currency`, fechado en su propio
`createdAt`. Implementado independientemente en dos lugares porque son dos caminos de
escritura que no se llaman entre sí: el `.upgrade()` de `db.version(3)` (para quien ya
tiene datos locales) y `migrateV2ToV3` (para quien restaura un `.finance` viejo, que
escribe la tabla directo vía `bulkAdd`/`addMissing`, sin pasar por el `.upgrade()` de
Dexie). Verificado a mano contra la base real del usuario (con su consentimiento
explícito, sin exportar backup antes por decisión suya) además de con tests que seedean
una DB en versión 2 y confirman el lote heredado tras abrir en versión 3.

**Riesgo residual, mismo aceptado que en el ADR anterior:** un backup con dos holdings
duplicados para el mismo `assetId` (ya documentado como riesgo residual arriba) migra a
dos lotes heredados en vez de uno — no se resuelve acá tampoco, mismo costo ya aceptado.

**Detalle no obvio:** `recomputeHoldingAggregate` tiene que poder hacer que
`averageCost` pase de tener valor a `undefined` (cuando se borra el único lote que
tenía costo cargado, dejando sólo lotes sin costear). Un `.update(id, patch)` de Dexie
no puede lograr esto — un campo ausente del `patch` conserva su valor viejo, nunca lo
limpia. Por eso el recompute usa `.put()` (reemplazo completo de la fila), no
`.update()`. Verificado revirtiendo a `.update()` a mano y confirmando que el test
`investmentLots.repo.test.ts` correspondiente falla (`expected undefined, received
10000`) antes de restaurar el fix.

## Cotizaciones automáticas de CEDEARs (data912)

**Decisión:** cuarto proveedor automático, `features/quotes/providers/data912.ts` —
verificado con una request real antes de conectarlo, mismo criterio que los otros tres
(ver ADR "Cotizaciones automáticas: proveedores, frescura y fallos" arriba).
**data912.com** (https://data912.com) es un mirror gratis, sin key y con CORS
habilitado de datos de BYMA (Bolsas y Mercados Argentinos), mantenido por la comunidad
fintech argentina — no es la bolsa ni un broker oficial. Su endpoint
`/live/arg_cedears` devuelve todos los CEDEARs que conoce en una sola respuesta (sin
query por símbolo), así que `refreshQuotes()` sólo lo llama cuando existe al menos un
`InvestmentAsset` `cedear` con `priceMode: 'auto'`, para no hacer un request que nadie
necesita. El campo `externalId` para este proveedor es directamente el ticker con el
que el CEDEAR cotiza en BYMA (ej. `"KO"`, `"SPY"`) — a diferencia del id de CoinGecko,
normalmente coincide con el símbolo que el usuario ya conoce.

`investmentAssetSchema`'s `refine` (antes sólo `type === 'crypto'`) ahora acepta
`priceMode: 'auto'` también para `type === 'cedear'` — mismo `externalId` obligatorio,
mismo mensaje de invariante actualizado. El conjunto de tipos con proveedor
(`AUTO_PRICE_ASSET_TYPES`) vive en `domain/entities/schemas.ts` como única fuente de
verdad, reusada por ese `refine`, por `features/networth/service.ts` y por el formulario
— evita que un quinto proveedor futuro actualice tres de los cuatro lugares que antes
repetían este mismo chequeo por separado.

**Encontrado en revisión — moneda de un CEDEAR (bloqueante, corregido antes de
mergear):** un CEDEAR sólo cotiza en pesos en BYMA — no existe versión en otra moneda —
pero nada impedía crear un activo `type: 'cedear'` con `currency: 'USD'` (el default del
formulario), y `fetchData912CedearPrices()` siempre devuelve `currency: 'ARS'`. El
resultado: `getInvestmentHoldingsWithDetails` descarta ese precio por currency mismatch
y muestra "sin precio cargado" en Inversiones, mientras que `valuateNetWorth` (usada por
el total del Dashboard y el gráfico de patrimonio) no tiene ese mismo guard y sí lo usa
— dos pantallas mostrando información contradictoria sobre el mismo activo, sin ningún
error visible. Se agregó un segundo `refine` al `investmentAssetSchema` (`type ===
'cedear'` exige `currency === 'ARS'`), un invariante equivalente en
`investments.repo.ts:createInvestmentAsset` (la validación de Zod sólo corre al
importar un backup, nunca al crear un activo desde la UI — ver "Riesgo" más abajo), y en
el formulario: elegir tipo CEDEAR fija la moneda a ARS automáticamente y bloquea el
selector, en vez de dejar el default `USD` silencioso.

**Encontrado en revisión — colisión de `externalId` entre proveedores (bloqueante,
corregido antes de mergear):** la primera versión unía las cotizaciones de CoinGecko y
data912 en un único `Map` indexado por `externalId` antes de escribir precios,
razonando que "los espacios de id no se superponen en la práctica". Pero `externalId`
es texto libre sin validar contra el proveedor real — nada impide que un activo
`crypto` y uno `cedear` compartan el mismo string (typo, o un backup mergeado de dos
dispositivos), y de darse el caso, uno de los dos recibía silenciosamente el precio del
otro, en la moneda del otro. Se separó en un `Map` por proveedor (`applyQuotes()` en
`features/quotes/service.ts`, llamado una vez por proveedor en vez de sobre una lista
combinada) — mismo espíritu que ya evitaba la colisión de `externalId` *dentro* de un
mismo proveedor (dos activos cripto con el mismo id de CoinGecko), extendido para que
tampoco pase *entre* proveedores distintos. Verificado revirtiendo a un único `Map`
combinado y confirmando que el test de regresión correspondiente
(`quotes/service.test.ts`) falla exactamente así antes de restaurar el fix.

**Por qué es seguro pese a no ser una fuente oficial:** sigue el mismo modelo de
tolerancia a fallos que ya tenían los otros tres proveedores (ver "Fallos" en el ADR de
arriba) — `fetchData912CedearPrices()` nunca tira, un fallo de red/timeout/forma
inesperada devuelve `[]`, y `AssetPrice` sigue siendo append-only: `refreshQuotes()`
nunca borra ni pisa una cotización ya cargada, así que si data912 está caído o
desaparece, el precio más reciente válido en IndexedDB sigue siendo el que se usa en
toda valuación — ninguna cuenta, movimiento ni balance depende de que este proveedor en
particular esté disponible.

**Respaldo manual explícito, pedido por el usuario:** hasta esta feature, un
`InvestmentAsset` sólo podía configurarse en el momento de crearlo — no había forma de
volver a modo manual después sin borrarlo y cargarlo de nuevo. Se agregó
`updateInvestmentAssetFromForm` (`features/networth/service.ts`) y un modo de edición en
`InvestmentAssetFormDialog` (ícono de engranaje en `InvestmentRow`/`InvestmentAssetRow`)
que permite prender o apagar el switch de precio automático en cualquier momento, sin
tocar tipo ni moneda (fijos desde la creación — cambiarlos rompería el invariante de
que todo `InvestmentLot` comparte la moneda de su activo, o cambiaría silenciosamente
la elegibilidad de proveedor). Apagar el switch hace que `refreshQuotes()` deje de
intentar el fetch automático para ese activo, y "Cargar precio" (siempre disponible,
independiente de `priceMode`) sigue siendo el camino para cargar un precio a mano —
exactamente el respaldo pedido para el caso "la API está caída, quiero seguir yo".

**Encontrado en revisión — borrar el símbolo al editar no lo borraba (medio, corregido
antes de mergear):** mismo patrón que ya se había arreglado esta sesión para
`InvestmentLot.costPerUnit` (ver ADR "Tracking de inversiones por lote" arriba), esta
vez en `InvestmentAsset.symbol` — que además de cosmético dobla como título de la fila
(`asset.symbol ?? asset.name`). `updateInvestmentAssetFromForm` omitía `symbol` del
patch cuando el campo quedaba vacío (mismo criterio que sí es correcto en `create`, pero
no en `update`), y `investments.repo.ts:updateInvestmentAsset` usaba `.update()`
parcial de Dexie — que no puede borrar una clave ausente del patch. Se corrigió
agregando el mismo tri-state (`symbol: null` para borrar explícito) y cambiando
`updateInvestmentAsset` a `.put()` (reemplazo completo de la fila), igual que
`investmentLots.repo.ts:updateInvestmentLot`.

**Descartado:** exponer `type`/`currency` como editables también. Cambiar `currency`
rompería el invariante `InvestmentLot.currency === asset.currency` para lotes ya
cargados (ver ADR "Tracking de inversiones por lote" arriba); cambiar `type` ganaría o
perdería elegibilidad de proveedor de forma no obvia para el usuario. Borrar el activo y
cargarlo de nuevo ya cubre ese caso, mucho menos frecuente que ajustar el switch de auto.

**Riesgo aceptado:** al ser un mirror no oficial, data912 puede cambiar de forma o dejar
de responder sin aviso — mismo tipo de riesgo ya aceptado para dolarapi.com y CoinGecko.
No hay SLA ni contacto de soporte; si esto se vuelve un problema recurrente, la salida es
simplemente apagar el switch por activo (o desactivar `Settings.autoQuotesEnabled` del
todo) y seguir cargando el precio a mano, sin perder ningún dato ya guardado.
