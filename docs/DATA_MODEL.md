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

### RecurringPlan / InstallmentPlan

Los planes son **plantillas**, no transacciones. Un `RecurringPlan` define una regla de
recurrencia (`freq`, `interval`, etc.) y un template; un `InstallmentPlan` define un
monto total y una cantidad de cuotas, con `scheduleCache` (el resultado de `allocate()`)
guardado una sola vez al crear el plan para que el cronograma no cambie si se recalcula
después.

Cuando corresponde, un plan **materializa** una `Transaction` real (con
`sourcePlanId` seteado). Esto es deliberado: permite editar o marcar como pagada una
cuota puntual sin afectar el resto, y mantiene el historial inmutable — ver
`docs/DECISIONS.md`.

### Budget

`startsOn` (mes) define desde cuándo rige ese monto. Para cambiar un presupuesto a mitad
de año sin perder el historial de "cuánto presupuestaba antes", se crea un `Budget` nuevo
con `startsOn` posterior en vez de editar el existente.

### ExchangeRate

Tasas cargadas manualmente por el usuario, nunca por una API externa (ver "Privacidad" en
`CLAUDE.md`). `src/domain/currency/rates.ts` resuelve la tasa vigente para una fecha como
"la más reciente con `date <= fecha buscada`", con fallback al recíproco de la tasa
inversa si no hay una directa.

### Settings

Documento único (`id: 'singleton'`). `baseCurrency` es la moneda a la que se consolidan
los totales de patrimonio/reportes.

## Índices Dexie (versión 1)

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

## Formato de backup (independiente del schema de Dexie)

```jsonc
{
  "format": "moneta-backup",
  "version": 1,
  "exportedAt": "2026-08-23T14:03:11.000Z",
  "app": { "name": "moneta", "version": "0.0.0" },
  "checksum": "sha256 hex sobre `data` canonicalizado",
  "data": {
    "accounts": [], "categories": [], "transactions": [], "postings": [],
    "recurringPlans": [], "installmentPlans": [], "budgets": [],
    "exchangeRates": [], "settings": {}
  }
}
```

Reglas (ver `src/features/backups/`):

- Cada versión tiene su propio Zod schema (`schemas/v1.ts`, futuro `schemas/v2.ts`, ...).
  **Un schema publicado no se edita nunca** — un archivo `.finance` viejo tiene que poder
  importarse siempre. Un cambio de formato agrega una versión nueva más su migración
  (`migrations/vN_to_vN+1.ts`).
- `migrateToLatest()` corre la cadena hasta la versión más reciente y falla explícito si
  el archivo es de una versión más nueva que la app instalada (mensaje claro, no un
  crash).
- Antes de escribir nada, el import corre `validateLedgerIntegrity()` sobre **todas** las
  transacciones del archivo — mismos invariantes que una escritura normal. Un backup
  corrupto o editado a mano queda rechazado sin tocar la base actual.
- El checksum se recalcula y se compara: si no coincide, se avisa pero no se bloquea el
  import (podría ser una edición manual legítima).
