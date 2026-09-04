import { z } from 'zod'

const dateStamp = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const monthStamp = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM')
const isoInstant = z.string().datetime()
const currencyCode = z.string().min(3).max(8)
const minorAmount = z.number().int()
const quantityScaled = z.number().int().nonnegative()
const id = z.string().min(1)

export const accountTypeSchema = z.enum(['cash', 'bank', 'card', 'investment', 'loan', 'other'])

export const accountSchema = z.object({
  id,
  name: z.string().min(1),
  type: accountTypeSchema,
  currency: currencyCode,
  openingBalance: minorAmount,
  isArchived: z.boolean(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Account = z.infer<typeof accountSchema>

export const categoryKindSchema = z.enum(['income', 'expense'])

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

// 'investment': una compra de inversión pagada desde una cuenta — misma
// forma de postings que 'expense' (cuenta - / categoría +), pero un kind
// distinto la deja afuera de "Gasto por categoría" y Presupuestos sin
// ningún caso especial de filtrado (ambos filtran por Transaction.kind,
// nunca por el kind de la categoría). Ver domain/ledger/builders.ts:
// buildInvestmentPurchase y el ADR "Una compra de inversión no es un
// gasto" en docs/DECISIONS.md.
export const transactionKindSchema = z.enum(['income', 'expense', 'transfer', 'adjustment', 'investment'])
export const transactionStatusSchema = z.enum(['confirmed', 'projected'])

export const transactionFxSchema = z.object({
  rate: z.number().positive(),
  from: currencyCode,
  to: currencyCode,
})

export const transactionSchema = z.object({
  id,
  date: dateStamp,
  kind: transactionKindSchema,
  description: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: transactionStatusSchema,
  fx: transactionFxSchema.optional(),
  sourcePlanId: id.optional(),
  occurrenceIndex: z.number().int().nonnegative().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Transaction = z.infer<typeof transactionSchema>

export const postingTargetSchema = z.enum(['account', 'category'])

export const postingSchema = z
  .object({
    id,
    transactionId: id,
    target: postingTargetSchema,
    accountId: id.optional(),
    categoryId: id.optional(),
    amount: minorAmount,
    currency: currencyCode,
    date: dateStamp,
  })
  .refine((p) => (p.target === 'account' ? !!p.accountId && !p.categoryId : true), {
    message: 'Account postings must set accountId and not categoryId',
  })
  .refine((p) => (p.target === 'category' ? !!p.categoryId && !p.accountId : true), {
    message: 'Category postings must set categoryId and not accountId',
  })
export type Posting = z.infer<typeof postingSchema>

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

export const transactionTemplateSchema = z.object({
  description: z.string().min(1),
  kind: transactionKindSchema,
  accountId: id,
  categoryId: id.optional(),
  toAccountId: id.optional(),
  amount: minorAmount,
  currency: currencyCode,
})
export type TransactionTemplate = z.infer<typeof transactionTemplateSchema>

export const recurringPlanSchema = z.object({
  id,
  template: transactionTemplateSchema,
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
  accountId: id,
  categoryId: id,
  totalAmount: minorAmount,
  currency: currencyCode,
  count: z.number().int().positive(),
  firstDueDate: dateStamp,
  purchaseDate: dateStamp,
  scheduleCache: z.array(minorAmount),
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
export const investmentLotSchema = z.object({
  id,
  assetId: id,
  quantity: quantityScaled,
  costPerUnit: minorAmount.optional(),
  currency: currencyCode,
  date: dateStamp,
  notes: z.string().optional(),
  // Movimiento del ledger que descontó esta compra de una cuenta — sólo
  // si se eligió "Cuenta de origen" al crearla. Se resincroniza (monto y
  // fecha) si se edita cantidad/costo/fecha de la compra; nunca se
  // crea/cambia/borra al editar. Ver ADR "Una compra de inversión no es
  // un gasto" en docs/DECISIONS.md.
  transactionId: id.optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
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
