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
- Borrar un plan nunca borra una transacción `confirmed` — ver el ADR correspondiente en
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
