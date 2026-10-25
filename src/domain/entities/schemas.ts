import { z } from 'zod'

const dateStamp = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const monthStamp = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM')
const isoInstant = z.string().datetime()
const currencyCode = z.string().min(3).max(8)
const minorAmount = z.number().int()
const quantityScaled = z.number().int().nonnegative()
const id = z.string().min(1)

// Vuelve en la Etapa 8 junto con Income (ver ADR "Se reintroducen Cuentas,
// Ingresos y Transferencias" en docs/DECISIONS.md): un gasto sólo puede
// usar una categoría 'expense', un ingreso sólo una 'income'.
export const categoryKindSchema = z.enum(['expense', 'income'])
export type CategoryKind = z.infer<typeof categoryKindSchema>

export const categorySchema = z.object({
  id,
  name: z.string().min(1),
  kind: categoryKindSchema,
  parentId: id.optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  isArchived: z.boolean(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Category = z.infer<typeof categorySchema>

export const expenseStatusSchema = z.enum(['confirmed', 'projected'])

// Un gasto es un registro simple — fecha, monto, moneda, categoría — sin
// partida doble: ver ADR "Simplificación: se elimina Cuentas, Ingresos y
// Transferencias" en docs/DECISIONS.md. `status` sigue haciendo falta para
// un recurrente/cuota que todavía no venció (`'projected'`) — sólo los
// `'confirmed'` cuentan en reportes/presupuestos.
//
// Medio de pago (Etapa 8), a lo sumo uno:
// - `accountId`: débito — el gasto sale de esa cuenta y baja su saldo.
// - `cardId` + `statementPeriod`: tarjeta de crédito — entra al resumen de
//   ese período (el mes en que cierra), que se paga después (Fase 5). El
//   período se GUARDA, no se deriva cada vez: una cuota cae directo en su
//   resumen, una presentación tardía se mueve a mano, y un resumen ya
//   cerrado no cambia si después se edita una fecha. Ver domain/cards.
// - ninguno: sin especificar; no toca ningún saldo.
export const expenseSchema = z
  .object({
  id,
  date: dateStamp,
  amount: minorAmount.positive(),
  currency: currencyCode,
  categoryId: id,
  description: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: expenseStatusSchema,
  sourcePlanId: id.optional(),
  occurrenceIndex: z.number().int().nonnegative().optional(),
  accountId: id.optional(),
  cardId: id.optional(),
  statementPeriod: monthStamp.optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
  .refine((e) => (e.cardId === undefined) === (e.statementPeriod === undefined), {
    message: 'Un gasto con tarjeta necesita su resumen (y viceversa)',
    path: ['statementPeriod'],
  })
  .refine((e) => e.accountId === undefined || e.cardId === undefined, {
    message: 'Un gasto se paga con débito o con tarjeta, no con los dos',
    path: ['cardId'],
  })
export type Expense = z.infer<typeof expenseSchema>

export const accountTypeSchema = z.enum(['bank', 'cash', 'wallet', 'broker', 'other'])
export type AccountType = z.infer<typeof accountTypeSchema>

// Moneda fija: todo movimiento que toca la cuenta está en esta moneda
// (invariante de los repositories). `openingBalance` es el saldo al inicio
// de `openingDate` — puede ser negativo (un descubierto). Ningún movimiento
// puede tener fecha anterior a `openingDate`. Ver domain/accounts.
export const accountSchema = z.object({
  id,
  name: z.string().min(1),
  type: accountTypeSchema,
  currency: currencyCode,
  openingBalance: minorAmount,
  openingDate: dateStamp,
  isArchived: z.boolean(),
  order: z.number(),
  notes: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Account = z.infer<typeof accountSchema>

// Imagen espejo de Expense, con `accountId` obligatorio: un ingreso siempre
// entra a alguna cuenta (el efectivo es una cuenta más).
export const incomeSchema = z.object({
  id,
  date: dateStamp,
  amount: minorAmount.positive(),
  currency: currencyCode,
  accountId: id,
  categoryId: id,
  description: z.string().min(1),
  notes: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Income = z.infer<typeof incomeSchema>

// Diferencia con signo para conciliar el saldo calculado contra el real
// (intereses, centavos). Nunca cero: un ajuste nulo no aporta nada.
export const accountAdjustmentSchema = z.object({
  id,
  accountId: id,
  date: dateStamp,
  amount: minorAmount.refine((n) => n !== 0, 'Un ajuste no puede ser cero'),
  currency: currencyCode,
  description: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type AccountAdjustment = z.infer<typeof accountAdjustmentSchema>

// Etapa 8, Fase 2. Guarda los DOS montos reales (lo que salió y lo que
// entró, cada uno en la moneda de su cuenta) — nunca una tasa para
// recalcular uno del otro: comprar dólares tiene un tipo de cambio
// efectivo que sólo el banco sabe, y redondear con una tasa podría
// inventar o perder un centavo. Si las dos cuentas tienen la misma moneda,
// los montos son iguales (invariante de domain/accounts:transferProblem).
export const transferSchema = z.object({
  id,
  date: dateStamp,
  fromAccountId: id,
  toAccountId: id,
  fromAmount: minorAmount.positive(),
  fromCurrency: currencyCode,
  toAmount: minorAmount.positive(),
  toCurrency: currencyCode,
  description: z.string().min(1),
  notes: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Transfer = z.infer<typeof transferSchema>

// Etapa 8, Fase 4. Sin moneda: un resumen argentino trae saldo en ARS y en
// USD por separado. `closingDay`/`dueDay` son los días por defecto; el mes
// en que el banco los mueve se corrige con un CardStatement.
export const creditCardSchema = z.object({
  id,
  name: z.string().min(1),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
  /** Purchases on the closing day go to the next statement — as most
   *  banks bill them, presented after the cut. Absent = they enter the
   *  statement that closes that day. Optional and additive: every backup
   *  version validates the same with or without it. */
  closingDayToNext: z.boolean().optional(),
  /** What was owed on the card when it was added to Moneta — the closed,
   *  unpaid statement and what the open one had so far — as totals per
   *  statement and currency, never itemized. Not a gasto: it was spent
   *  before Moneta (like an account's opening balance). Optional and
   *  additive: every backup version validates the same without it. */
  openingBalances: z
    .array(z.object({ period: monthStamp, currency: currencyCode, amount: minorAmount.positive() }))
    .optional(),
  /** The closed statement the opening balance was entered for (the open
   *  one is the month after) — kept, so editing the card months later
   *  still means the same statements. Present whenever openingBalances is. */
  openingBase: monthStamp.optional(),
  isArchived: z.boolean(),
  order: z.number(),
  notes: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type CreditCard = z.infer<typeof creditCardSchema>

// Fechas reales de un resumen cuando difieren de los días por defecto de la
// tarjeta — sólo existe una fila para los períodos corregidos a mano.
// `period` es el mes en que cierra el resumen ("YYYY-MM").
export const cardStatementSchema = z
  .object({
    id,
    cardId: id,
    period: monthStamp,
    closeDate: dateStamp,
    dueDate: dateStamp,
    createdAt: isoInstant,
    updatedAt: isoInstant,
  })
  .refine((s) => s.dueDate >= s.closeDate, {
    message: 'El vencimiento no puede ser anterior al cierre',
    path: ['dueDate'],
  })
export type CardStatement = z.infer<typeof cardStatementSchema>

// Etapa 8, Fase 5: el pago de un resumen, una fila por moneda del resumen
// (un resumen trae ARS y USD por separado). `amount` está en `currency` (la
// del resumen); `debitedAmount` en `debitedCurrency` (la de la cuenta) — los
// DOS montos reales, nunca una tasa (mismo criterio que Transfer). Pagar un
// resumen nunca crea un gasto: cada compra ya se contó en su fecha; sólo
// baja el saldo de la cuenta. Sólo pago total (ver ADR).
export const statementPaymentSchema = z.object({
  id,
  cardId: id,
  period: monthStamp,
  currency: currencyCode,
  amount: minorAmount.positive(),
  accountId: id,
  debitedAmount: minorAmount.positive(),
  debitedCurrency: currencyCode,
  date: dateStamp,
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type StatementPayment = z.infer<typeof statementPaymentSchema>

export const recurrenceFrequencySchema = z.enum(['daily', 'weekly', 'monthly', 'yearly'])

export const recurrenceRuleSchema = z.object({
  freq: recurrenceFrequencySchema,
  interval: z.number().int().positive(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  startDate: dateStamp,
  endDate: dateStamp.optional(),
  maxOccurrences: z.number().int().positive().optional(),
})
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>

// Medio de pago de un recurrente (Etapa 8, Fase 4b): a lo sumo uno —
// débito de una cuenta o tarjeta de crédito. Cada gasto generado lo hereda;
// con tarjeta, entra al resumen que corresponde a su fecha.
export const expenseTemplateSchema = z
  .object({
    description: z.string().min(1),
    categoryId: id,
    amount: minorAmount.positive(),
    currency: currencyCode,
    accountId: id.optional(),
    cardId: id.optional(),
  })
  .refine((t) => t.accountId === undefined || t.cardId === undefined, {
    message: 'Un recurrente se paga con débito o con tarjeta, no con los dos',
    path: ['cardId'],
  })
export type ExpenseTemplate = z.infer<typeof expenseTemplateSchema>

export const recurringPlanSchema = z.object({
  id,
  template: expenseTemplateSchema,
  rule: recurrenceRuleSchema,
  lastMaterializedDate: dateStamp.optional(),
  isPaused: z.boolean(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type RecurringPlan = z.infer<typeof recurringPlanSchema>

export const installmentPlanSchema = z.object({
  id,
  description: z.string().min(1),
  categoryId: id,
  totalAmount: minorAmount,
  currency: currencyCode,
  count: z.number().int().positive(),
  firstDueDate: dateStamp,
  purchaseDate: dateStamp,
  scheduleCache: z.array(minorAmount),
  // Etapa 8, Fase 4b: comprada con tarjeta — la cuota i va al resumen de la
  // compra + i (domain/cards:installmentStatementPeriod).
  cardId: id.optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type InstallmentPlan = z.infer<typeof installmentPlanSchema>

export const budgetPeriodSchema = z.enum(['monthly', 'yearly'])

export const budgetSchema = z.object({
  id,
  categoryId: id,
  currency: currencyCode,
  period: budgetPeriodSchema,
  amount: minorAmount,
  startsOn: monthStamp,
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Budget = z.infer<typeof budgetSchema>

/** How a quote (exchange rate or asset price) was obtained — 'automatic'
 *  only exists once a quotes provider is wired up (Etapa 6C), but the
 *  field is added now so both a manually-loaded rate today and a
 *  provider-fetched one later share the same shape. */
export const quoteSourceSchema = z.enum(['manual', 'automatic'])

export const exchangeRateSchema = z.object({
  id,
  date: dateStamp,
  from: currencyCode,
  to: currencyCode,
  rate: z.number().positive(),
  // All optional: a rate loaded before this field existed (or by a v1
  // backup migrated to v2) has none of these, and still works — resolveRate
  // treats a rate without `profile` as a wildcard match. See
  // domain/currency/rates.ts.
  profile: z.string().optional(),
  source: quoteSourceSchema.optional(),
  capturedAt: isoInstant.optional(),
})
export type ExchangeRate = z.infer<typeof exchangeRateSchema>

export const themeSchema = z.enum(['light', 'dark', 'system'])

export const settingsSchema = z.object({
  id: z.literal('singleton'),
  baseCurrency: currencyCode,
  locale: z.string(),
  firstDayOfMonth: z.number().int().min(1).max(28),
  theme: themeSchema,
  schemaVersion: z.number().int().nonnegative(),
  displayCurrency: currencyCode.optional(),
  rateProfile: z.string().optional(),
  autoQuotesEnabled: z.boolean().optional(),
  quotesRefreshedAt: isoInstant.optional(),
  lastBackupExportedAt: isoInstant.optional(),
  lastBackupImportedAt: isoInstant.optional(),
  hideSavingsAndInvestmentsAmount: z.boolean().optional(),
  // Free string, not an enum: matched against the registry in
  // src/app/color-themes.ts, which falls back to the default theme for
  // any unknown id (including one from an old backup for a theme since
  // removed) instead of failing validation.
  colorTheme: z.string().optional(),
})
export type Settings = z.infer<typeof settingsSchema>

export const savingsHoldingSchema = z.object({
  id,
  name: z.string().min(1),
  currency: currencyCode,
  amount: minorAmount,
  location: z.string().optional(),
  notes: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type SavingsHolding = z.infer<typeof savingsHoldingSchema>

export const investmentAssetTypeSchema = z.enum(['etf', 'stock', 'cedear', 'bond', 'fund', 'crypto', 'other'])

/** The only types with an automatic price provider wired up — see
 *  features/quotes/providers/. Single source of truth reused by the
 *  refine below, `features/networth/service.ts`, `features/quotes/
 *  service.ts` and the asset form, so a 5th provider (or a currency
 *  requirement change) only needs updating in one place. */
export const AUTO_PRICE_ASSET_TYPES = ['crypto', 'cedear'] as const

export const priceModeSchema = z.enum(['manual', 'auto'])

export const investmentAssetSchema = z
  .object({
    id,
    name: z.string().min(1),
    symbol: z.string().optional(),
    type: investmentAssetTypeSchema,
    currency: currencyCode,
    priceMode: priceModeSchema,
    // Provider-specific identifier (e.g. CoinGecko's coin id) — set only
    // when priceMode is 'auto' and a provider exists for this asset's type.
    externalId: z.string().optional(),
    createdAt: isoInstant,
    updatedAt: isoInstant,
  })
  // Defense in depth: today only crypto (via CoinGecko) and cedear (via
  // data912) have an automatic provider — see features/quotes/providers/.
  // Without this, a backup import/merge could otherwise slip in an
  // 'auto' asset of some other type that refreshQuotes() would then
  // silently never update (it's not eligible for any provider, but
  // nothing would say so).
  .refine((a) => a.priceMode !== 'auto' || ((AUTO_PRICE_ASSET_TYPES as readonly string[]).includes(a.type) && !!a.externalId), {
    message: "priceMode 'auto' requires type 'crypto' or 'cedear', and a non-empty externalId",
    path: ['priceMode'],
  })
  // A CEDEAR only ever trades in pesos on BYMA — there's no such thing as
  // a USD-denominated one. Without this, an asset created with type
  // 'cedear' and currency left at its form default ('USD') would fetch a
  // data912 quote (always ARS) that then gets treated as "no price" by
  // getInvestmentHoldingsWithDetails's currency guard, silently.
  .refine((a) => a.type !== 'cedear' || a.currency === 'ARS', {
    message: "Un activo 'cedear' sólo puede estar en ARS",
    path: ['currency'],
  })
export type InvestmentAsset = z.infer<typeof investmentAssetSchema>

// InvestmentHolding.quantity/averageCost son un agregado cacheado de sus
// InvestmentLot (ver más abajo) — nunca se editan a mano directamente,
// se recalculan transaccionalmente cada vez que un lote cambia. Ver ADR
// "Tracking de inversiones por lote" en docs/DECISIONS.md.
export const investmentHoldingSchema = z.object({
  id,
  assetId: id,
  // Scaled integer, same idea as Minor for money — see
  // domain/decimal/quantity.ts. Never a float: 8 decimals of precision
  // fit in a safe integer for any realistic position size.
  quantity: quantityScaled,
  averageCost: minorAmount.optional(),
  notes: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type InvestmentHolding = z.infer<typeof investmentHoldingSchema>

// Una compra real de un activo — fecha, cantidad, costo por unidad.
// InvestmentHolding es la suma de sus lotes; nunca al revés. costPerUnit
// es opcional con el mismo criterio que InvestmentHolding.averageCost
// tenía antes: si no se cargó costo, no se inventa uno.
//
// Cuenta de origen (Etapa 8, Fase 3): `sourceAccountId` + `sourceAmount`
// + `sourceCurrency`, los tres o ninguno. `sourceAmount` es lo que
// realmente se debitó de la cuenta, en SU moneda, comisiones incluidas —
// no se deriva de quantity × costPerUnit (pueden diferir en moneda y en
// comisiones). Comprar una inversión no es un gasto: sólo baja el saldo
// de la cuenta, nunca pasa por categorías ni presupuestos.
export const investmentLotSchema = z
  .object({
    id,
    assetId: id,
    quantity: quantityScaled,
    costPerUnit: minorAmount.optional(),
    currency: currencyCode,
    date: dateStamp,
    notes: z.string().optional(),
    sourceAccountId: id.optional(),
    sourceAmount: minorAmount.positive().optional(),
    sourceCurrency: currencyCode.optional(),
    createdAt: isoInstant,
    updatedAt: isoInstant,
  })
  .refine(
    (lot) =>
      (lot.sourceAccountId === undefined) === (lot.sourceAmount === undefined) &&
      (lot.sourceAmount === undefined) === (lot.sourceCurrency === undefined),
    { message: 'Cuenta de origen, monto debitado y su moneda van juntos', path: ['sourceAccountId'] },
  )
export type InvestmentLot = z.infer<typeof investmentLotSchema>

export const assetPriceSchema = z.object({
  id,
  assetId: id,
  price: minorAmount.positive(),
  currency: currencyCode,
  date: dateStamp,
  capturedAt: isoInstant,
  source: quoteSourceSchema,
})
export type AssetPrice = z.infer<typeof assetPriceSchema>
