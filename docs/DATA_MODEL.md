# DATA_MODEL.md

Fuente de verdad para tipos: `src/domain/entities/schemas.ts` (Zod). Este documento
explica el *por qué* del modelo; para el shape exacto, leé ese archivo.

## Dinero

```ts
type Minor = number & { readonly __minorUnit: unique symbol } // entero, unidades menores
type Money = { amount: Minor; currency: CurrencyCode }
```

Todo importe se guarda como entero en la unidad menor de su moneda (centavos para
ARS/USD). `$10,50` es `1050`. Ver "Reglas financieras" en `CLAUDE.md`.

## Entidades

### Account

Una cuenta tiene **moneda fija** (`currency`). Todos sus postings están en esa moneda —
nunca se convierte implícitamente. `openingBalance` es el saldo al momento de crear la
cuenta en Moneta (no necesariamente el saldo histórico real); el balance actual se
calcula como `openingBalance + suma de postings confirmados de esa cuenta`.

### Category

Un nivel de anidamiento (`parentId`). `kind` es `income` o `expense` — una categoría no
sirve para ambos tipos de movimiento.

### Transaction + Posting (ledger de partida doble ligera)

Una `Transaction` es el evento (fecha, descripción, tipo); los `Posting`s son los montos
con signo que efectivamente mueven dinero. Toda transacción tiene **2 o más** postings, y
sus montos suman cero (o se balancean vía `fx.rate` en una transferencia cross-currency,
con tolerancia de 1 unidad menor por redondeo).

Ingreso, gasto, transferencia y cuota son todos el mismo primitivo — sólo cambia qué
postings genera cada builder de `src/domain/ledger/builders.ts`:

- **Gasto**: posting de cuenta negativo + posting de categoría positivo.
- **Ingreso**: posting de cuenta positivo + posting de categoría negativo.
- **Transferencia** (misma moneda): posting negativo en la cuenta origen + positivo en la
  destino.
- **Transferencia cross-currency**: igual, pero cada posting está en la moneda de su
  cuenta y la `Transaction` lleva `fx: { rate, from, to }` para poder verificar que las
  dos puntas se corresponden.

Un `Posting` es de cuenta (`target: 'account'`, `accountId` seteado, `categoryId` no) o
de categoría (al revés) — nunca ambos ni ninguno. Esto se valida en
`validateLedgerEntry()` y con `.refine()` en el Zod schema.

`Transaction.status` es `'confirmed'` o `'projected'`. Sólo los postings de transacciones
`confirmed` cuentan para el balance de una cuenta — así una cuota o recurrente futura
puede "existir" en la base (para mostrarse en un calendario, por ejemplo) sin afectar el
saldo actual.

`sourcePlanId` + `occurrenceIndex` linkean una transacción materializada a el
`RecurringPlan` o `InstallmentPlan` que la generó.

**Editar una transacción reemplaza sus postings, no los diffea.** `saveTransaction()`
(`src/database/repositories/transactions.repo.ts`) borra los postings existentes e
inserta los nuevos derivados del formulario, dentro de la misma transacción Dexie `rw`;
conserva el `id` y el `createdAt` originales. Es más simple que un diff campo por campo y
sigue siendo atómico — ver `docs/DECISIONS.md` si se agrega ahí una entrada.

### RecurringPlan / InstallmentPlan

Los planes son **plantillas**, no transacciones. Un `RecurringPlan` define una regla de
recurrencia (`freq`, `interval`, etc.) y un template; un `InstallmentPlan` define un
monto total y una cantidad de cuotas, con `scheduleCache` (el resultado de `allocate()`)
guardado una sola vez al crear el plan para que el cronograma no cambie si se recalcula
después.

Cuando corresponde, un plan **materializa** una `Transaction` real (con
`sourcePlanId` + `occurrenceIndex` seteados). Esto es deliberado: permite editar o marcar
como pagada una cuota puntual sin afectar el resto, y mantiene el historial inmutable —
ver `docs/DECISIONS.md`.

- Un `RecurringPlan` sólo materializa transacciones `confirmed`, al ponerse al día
  (`lastMaterializedDate` → hoy) cada vez que se abre la app. No genera nada a futuro:
  no tiene un total de ocurrencias conocido de antemano (salvo que tenga
  `maxOccurrences`/`endDate`), así que no hay "cronograma completo" para previsualizar.
- Un `InstallmentPlan`, en cambio, sí conoce sus N cuotas desde el momento en que se crea
  (`scheduleCache` + fecha de cada una), así que las escribe todas de una vez: las que ya
  vencieron como `confirmed`, el resto como `projected`. Cada cuota `projected` pasa sola
  a `confirmed` el día que llega su fecha. `projected` ya estaba excluido de balances
  (`accounts.repo.ts`) y reportes (`reports/service.ts`) desde antes de esta feature, así
  que una cuota futura es visible (con badge en Movimientos) sin afectar ningún total.
- Borrar un plan, por default, nunca borra una transacción `confirmed` — salvo que el
  usuario tilde explícitamente "Borrar también los movimientos que ya generó" al borrar
  un recurrente (`deleteRecurringPlan(id, { deleteGeneratedTransactions: true })`, nunca
  el default). Ver los ADRs correspondientes en `docs/DECISIONS.md`.

### Budget

`startsOn` (mes) define desde cuándo rige ese monto. Para cambiar un presupuesto a mitad
de año sin perder el historial de "cuánto presupuestaba antes", se crea un `Budget` nuevo
con `startsOn` posterior en vez de editar el existente.

### ExchangeRate

Tasas cargadas manualmente por el usuario **o** traídas por un proveedor automático
opt-in (ver ADR "Cotizaciones automáticas, opt-in" en `docs/DECISIONS.md`).
`src/domain/currency/rates.ts:resolveRate` resuelve la tasa vigente para una fecha como
"la más reciente con `date <= fecha buscada`", con fallback al recíproco de la tasa
inversa si no hay una directa, y — última instancia — triangulación por USD si tampoco
hay una tasa directa/recíproca para el par pedido (ej. EUR→ARS vía EUR→USD y USD→ARS).
Un empate en `date` (ej. un fetch automático a la mañana y una corrección manual a la
tarde, mismo día) se desempata por `capturedAt` — timestamp completo, no sólo el día —
así que la carga más reciente en el tiempo real gana. Si alguna de las dos filas
empatadas no tiene `capturedAt` (una tasa de antes de la Etapa 6C), el desempate vuelve
a depender del orden de iteración, no determinístico.

`profile`, `source` y `capturedAt` son todos opcionales (una tasa cargada antes de que
existieran, o migrada desde un backup v1, no los tiene). `profile` identifica la
referencia (`'oficial' | 'mep' | 'ccl' | 'blue' | 'cripto' | 'mayorista' | 'tarjeta'` o
un string propio) — necesario porque en Argentina "1 USD = X ARS" no es una sola cifra.
`resolveRate` acepta un `profile` opcional: si se pide uno y existe, lo usa; si no, cae a
una tasa sin `profile` (el comodín histórico), nunca a la de otra referencia distinta.
`source` distingue `'manual'` de `'automatic'` sólo para mostrarlo en la UI de
Cotizaciones — no cambia cómo se resuelve la tasa vigente (la más reciente gana, sea cual
sea su fuente, así que una carga manual posterior a un fetch automático la reemplaza sin
mecanismo especial).

### SavingsHolding

Ahorros que no pasan por el ledger: plata que el usuario tiene pero no registra como
movimientos (efectivo, una caja de ahorro que no concilia). `amount` es el importe
completo en `currency` — no hay concepto de "postings" ni de historial de movimientos
para un ahorro, es un valor que se edita directamente.

### InvestmentAsset / InvestmentHolding / InvestmentLot / AssetPrice

Cuatro entidades separadas a propósito (ver ADR "Modelo de dominio para inversiones" en
`docs/DECISIONS.md`) — nunca se modela una inversión como si fuera simplemente una
moneda:

- **`InvestmentAsset`** es el instrumento (SPY, un CEDEAR, Bitcoin) — símbolo, tipo
  (`investmentAssetTypeSchema`: `etf | stock | cedear | bond | fund | crypto | other`), y
  la moneda en la que cotiza. `priceMode` (`'manual' | 'auto'`) decide si un refresh
  automático de cotizaciones lo toca.
- **`InvestmentLot`** es una compra real — cantidad, costo por unidad (opcional, mismo
  criterio que tenía `averageCost` antes: si no se cargó, no se inventa uno), moneda
  (denormalizada, mismo patrón que `AssetPrice`) y fecha. Es la fuente de verdad de
  cuánto tenés de un activo; nunca se edita una posición directo, se agrega/edita/borra
  una compra — ver ADR "Tracking de inversiones por lote" en `docs/DECISIONS.md`.
- **`InvestmentHolding`** es un **agregado cacheado**: la suma de los `InvestmentLot`
  de un activo (cantidad total + costo promedio ponderado —
  `domain/investments/lots.ts:aggregateLots`), recalculado transaccionalmente cada vez
  que un lote se crea/edita/borra (`database/repositories/investmentLots.repo.ts`) —
  nunca escrito a mano desde la UI. `quantity` es un entero escalado
  (`domain/decimal/quantity.ts:Quantity`, 8 decimales, mismo espíritu que `Minor` para
  plata) — nunca un float, porque una cantidad fraccionaria de un activo alimenta un
  cálculo monetario (`quantity × precio`). Sigue siendo la fila que lee todo el resto de
  la app (`valuateNetWorth`, `getInvestmentHoldingsWithDetails`, los gráficos de
  Ahorro e Inversiones) — el cambio a lotes no les pidió aprender nada nuevo.
  **Una sola fila por activo**, igual que antes de que existieran los lotes: el schema
  de Dexie no lo fuerza (`assetId` es sólo un índice secundario, no único), lo garantiza
  `investments.repo.ts:createInvestmentHolding` con un chequeo dentro de una transacción
  — ver ADR "'Nueva posición' no ofrece un activo que ya tiene holding" en
  `docs/DECISIONS.md` (incluye el riesgo residual que sigue existiendo: un backup
  importado puede traer holdings o lotes duplicados, porque el import escribe las tablas
  directo, sin pasar por el repository). Venta con ganancia realizada (consumir lotes
  por FIFO, en vez de sólo editar la cantidad a mano como hoy) queda en el backlog.
- **`AssetPrice`** es el precio del activo en una fecha, **append-only**: cada
  actualización (manual o automática) inserta una fila nueva, nunca pisa la anterior — da
  el historial de precios gratis y permite que una carga manual y el último fetch
  automático convivan sin caso especial (la más reciente por `date`/`capturedAt` gana).

El valor de una posición nunca es un atajo directo "activo → moneda de display": siempre
`quantity → domain/decimal:valuePosition(quantity, price)` (valor en la moneda del
activo) `→ domain/currency:convert(...)` (moneda de display) —
`domain/networth/valuation.ts:valuateNetWorth` es la única función que hace este cálculo.

### Settings

Documento único (`id: 'singleton'`). `baseCurrency` es la moneda a la que se consolidan
los reportes (Dashboard/Reportes). `displayCurrency` y `rateProfile` son la preferencia
independiente de patrimonio (moneda de visualización y qué referencia de tasa usar para
valuarlo) — si no están seteados, caen a `baseCurrency` y a "sin profile" respectivamente.
`autoQuotesEnabled` (default `false`) es el opt-in de cotizaciones automáticas;
`quotesRefreshedAt` es sólo para la UI ("última actualización hace X").
`lastBackupExportedAt`/`lastBackupImportedAt` son, de la misma forma, sólo para la UI de
Backup ("último export/import hace X") — se escriben desde `BackupCard.tsx` tras un
export deliberado del usuario (nunca desde el snapshot de seguridad automático previo a
un import, que llama a `exportBackup()` directamente) y desde `importBackup()` una vez
completada la escritura (`replaceAllTables`/`mergeAllTables`), para que no quede pisado
por lo que traiga el archivo importado.
`hideSavingsAndInvestmentsAmount` (default `false`) es el estado del ícono de ojo en la
card "Ahorro e inversiones" del Dashboard — puramente de UI (no oculta nada en
`/patrimonio`), pero vive en Settings en vez de un store de Zustand efímero porque tiene
sentido que persista entre sesiones (el punto de ocultar un monto es que siga oculto la
próxima vez que abrís la app).

Los siete son opcionales — agregados sobre un documento que ya existía, así que una fila
persistida antes de que existieran no los tiene.
`database/repositories/settings.repo.ts:getSettings()` los completa con
`{ ...DEFAULT_SETTINGS, ...existing }` en vez de `existing ?? DEFAULT_SETTINGS`,
justamente para que una fila vieja herede los defaults de campos que no tenía.

## Índices Dexie

**Versión 1:**

```
accounts:          id, name, type, currency, isArchived, order
categories:        id, name, kind, parentId, isArchived, order
transactions:      id, date, kind, status, sourcePlanId, [status+date], [kind+date]
postings:          id, transactionId, [accountId+date], [categoryId+date], date
recurringPlans:    id, isPaused, lastMaterializedDate
installmentPlans:  id, accountId, firstDueDate
budgets:           id, categoryId, [categoryId+startsOn]
exchangeRates:     id, [from+to+date], date
settings:          id
```

**Versión 2** (patrimonio — tablas nuevas, todas nacen vacías, sin `.upgrade()`):

```
savingsHoldings:     id, currency
investmentAssets:    id, type, symbol
investmentHoldings:  id, assetId
assetPrices:         id, [assetId+date], assetId, date
```

**Versión 3** (tracking de inversiones por lote — `investmentLots` es tabla nueva, pero
**sí** tiene `.upgrade()`: le crea un lote heredado a cada `InvestmentHolding` que ya
existía, para que de ahí en más todo holding tenga siempre ≥1 lote — ver ADR "Tracking
de inversiones por lote" en `docs/DECISIONS.md`):

```
investmentLots:      id, assetId, date
```

Dexie omite del índice las claves `undefined`, así que el índice compuesto
`[accountId+date]` sólo contiene postings de cuenta, y `[categoryId+date]` sólo los de
categoría — eso es lo que permite consultar "todos los postings de esta cuenta,
ordenados por fecha" con un `.where('[accountId+date]').between(...)` directo, sin table
scan.

## Versionado del schema de Dexie

Las versiones de `db.version(N).stores(...)` en `src/database/db.ts` son **append-only**:

- Nunca se edita ni se borra una versión ya shippeada.
- Un cambio de forma (agregar un índice, cambiar un campo) es una versión nueva, con su
  `.upgrade()` si hace falta migrar datos existentes.
- Bajar `LATEST_VERSION` o reordenar versiones corrompe las bases de usuarios existentes.
- Agregar una tabla completamente nueva **sin** datos previos que migrar (el caso de la
  versión 2) no necesita `.upgrade()` — Dexie la crea vacía. Una tabla nueva que sí
  necesita heredar datos de una tabla existente (el caso de la versión 3:
  `investmentLots` nace poblada con un lote por cada `InvestmentHolding` previo) lleva su
  propio `.upgrade()`.

## Formato de backup (independiente del schema de Dexie)

```jsonc
{
  "format": "moneta-backup",
  "version": 3,
  "exportedAt": "2026-08-23T14:03:11.000Z",
  "app": { "name": "moneta", "version": "0.0.0" },
  "checksum": "sha256 hex sobre `data` canonicalizado",
  "data": {
    "accounts": [], "categories": [], "transactions": [], "postings": [],
    "recurringPlans": [], "installmentPlans": [], "budgets": [],
    "exchangeRates": [], "settings": {},
    "savingsHoldings": [], "investmentAssets": [], "investmentHoldings": [],
    "assetPrices": [], "investmentLots": []
  }
}
```

Reglas (ver `src/features/backups/`):

- Cada versión tiene su propio Zod schema (`schemas/v1.ts`, `schemas/v2.ts`, ...).
  **Un schema publicado no se edita nunca** — un archivo `.finance` viejo tiene que poder
  importarse siempre. Un cambio de formato agrega una versión nueva más su migración
  (`migrations/vN_to_vN+1.ts`). La v2 (patrimonio) migra un v1 agregando las cuatro tablas
  nuevas como arrays vacíos (`migrations/v1_to_v2.ts`) — un `.finance` viejo se sigue
  pudiendo importar siempre, sólo que sin ahorros/inversiones porque nunca existieron. La
  v3 (tracking por lote) migra un v2 sintetizando un `InvestmentLot` heredado por cada
  `InvestmentHolding` con cantidad positiva (`migrations/v2_to_v3.ts`) — misma lógica que
  el `.upgrade()` de Dexie de la versión 3, para el camino de import en vez del de uso
  normal de la app.
- `migrateToLatest()` corre la cadena hasta la versión más reciente y falla explícito si
  el archivo es de una versión más nueva que la app instalada (mensaje claro, no un
  crash).
- Antes de escribir nada, el import corre `validateLedgerIntegrity()` sobre **todas** las
  transacciones del archivo — mismos invariantes que una escritura normal. Un backup
  corrupto o editado a mano queda rechazado sin tocar la base actual.
- El checksum se recalcula y se compara: si no coincide, se avisa pero no se bloquea el
  import (podría ser una edición manual legítima).

### Modo merge (`importBackup(file, { mode: 'merge' })`)

Alternativa a *replace* para consolidar el historial de dos dispositivos usados por
separado. Regla única: **agrega lo que falta, nunca pisa ni borra nada que ya exista
localmente** — ver el ADR en `docs/DECISIONS.md` para el porqué.

- `database/repositories/backup.repo.ts:mergeAllTables()` hace unión por ID en cada
  tabla: sólo se agrega una fila cuya ID no esté ya presente. Con `generateId()`
  (`lib/ids.ts`) la colisión de IDs entre dos dispositivos independientes es
  despreciable, así que "misma ID" en la práctica significa "es la misma entidad".
- `transactions` se dedupe por ID **y**, cuando tienen `sourcePlanId` +
  `occurrenceIndex`, también por ese par. Un `RecurringPlan` que ya existía en ambos
  dispositivos antes de que se usaran por separado materializa la misma ocurrencia
  calendario con un `id` de transacción distinto en cada uno (`generateId()` es
  aleatorio, no determinístico por fecha/plan) — dedupear sólo por `id` trataría esas dos
  transacciones como no relacionadas y duplicaría el monto en el balance de la cuenta.
- `postings` es la única tabla que **no** se mergea por su propia ID: una posting sólo se
  agrega si su `transactionId` es una transacción que *también* se está agregando en ese
  merge. Necesario porque editar una transacción (`transactions.repo.ts:writeLedgerEntry`)
  reemplaza sus postings conservando el `id` de la transacción — un backup viejo de una
  transacción ya editada localmente tiene postings con IDs que ya no existen en ningún
  lado, y agregarlos por su cuenta duplicaría el monto.
- Después de mergear, todo `RecurringPlan` (existente o recién agregado) recalcula su
  `lastMaterializedDate` al máximo `date` real entre sus transacciones locales con ese
  `sourcePlanId`, si es posterior al valor actual. Sin esto, `materializeDue()`
  (`features/plans/service.ts`) — que confía ciegamente en ese watermark para decidir qué
  falta materializar — trataría ocurrencias traídas por el merge como pendientes y las
  duplicaría en la próxima apertura de la app.
- `settings` (fila única `id: 'singleton'`) cae en la misma regla general sin caso
  especial: como casi siempre existe ya localmente, el `settings` del archivo se ignora
  por completo — la moneda base y el tema del dispositivo actual nunca cambian por un
  merge.
- Sin deduplicación de entidades por nombre: dos cuentas "Banco" con IDs distintas
  (creadas independientemente en cada dispositivo) quedan duplicadas después de un merge
  — se concilian a mano. Es una limitación de alcance deliberada, no un bug. Lo mismo
  aplica a `ExchangeRate`: dos tasas para el mismo `(date, from, to)` cargadas por
  separado en cada dispositivo quedan como filas distintas (a diferencia de una cuenta
  duplicada, esto no es sólo cosmético — para dos tasas del mismo `(date, from, to)` con
  `capturedAt`, `resolveRate()` desempata por la más reciente (igual que dentro de un
  solo dispositivo, ver más abajo); si alguna de las dos no tiene `capturedAt` (una fila
  vieja, de antes de la Etapa 6C), el desempate vuelve a ser no determinístico. De
  cualquier forma conviene revisar la pestaña Cotizaciones en Ahorro e Inversiones después de un
  merge si se cargaron tasas manualmente en ambos dispositivos). `AssetPrice` tiene
  la misma limitación (sin clave natural `(assetId, date)`, `generateId()` produce IDs
  distintos en cada dispositivo para lo que conceptualmente es "el mismo precio del mismo
  día") pero sin el problema de no-determinismo: `assetPrices.repo.ts:latestAssetPrices`
  siempre elige la fila con `date` más reciente y desempata por `capturedAt`, así que el
  resultado es estable — el costo es sólo acumular filas de precio duplicadas/en
  conflicto para el mismo día tras un merge entre dispositivos, no una valuación que
  cambia sola. Se revisita si Etapa 6C (cotizaciones automáticas, refrescos diarios en
  cada dispositivo abierto) hace que este caso se vuelva frecuente.

### Cifrado opcional (sobre independiente del formato de datos)

El objeto de arriba (`BackupV1`) nunca cambia por esto — cifrar es una capa de transporte
que lo envuelve entero, no una versión nueva del formato. Un `.finance` cifrado es:

```jsonc
{
  "format": "moneta-backup-encrypted",
  "version": 1,
  "kdf": "PBKDF2", "hash": "SHA-256", "iterations": 600000,
  "salt": "base64...", "iv": "base64...",
  "ciphertext": "base64... (el BackupV1 de arriba, JSON.stringify + AES-256-GCM)"
}
```

- `src/features/backups/encryption.ts`: `crypto.subtle` nativo del navegador, sin
  dependencias — PBKDF2-SHA256 (iteraciones guardadas en el sobre, no hardcodeadas, para
  poder subirlas a futuro sin romper backups viejos) deriva la clave, AES-256-GCM cifra.
  `salt`/`iv` frescos y aleatorios en cada export, incluso reusando la misma contraseña.
- Import detecta el formato por `isEncryptedBackup()` antes de intentar nada — si hace
  falta contraseña y no se pasó una, tira `PassphraseRequiredError` (distinto de un JSON
  inválido) para que la UI sepa que tiene que pedirla. Una vez desencriptado, el JSON
  plano pasa por **exactamente el mismo camino** que un backup sin cifrar
  (`migrateToLatest` → `validateLedgerIntegrity` → checksum → escritura).
- GCM es autenticado: contraseña incorrecta y archivo corrupto/editado son
  indistinguibles a propósito (evita un oráculo de padding) — un solo mensaje de error
  para ambos casos.
- **Sin recuperación.** Perder la contraseña de un backup cifrado lo deja inservible para
  siempre — no hay backdoor. Nunca es el comportamiento por defecto.
