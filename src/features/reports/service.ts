import {
  assetPricesRepo,
  categoriesRepo,
  exchangeRatesRepo,
  expensesRepo,
  investmentsRepo,
  savingsHoldingsRepo,
  settingsRepo,
} from '@/database/repositories'
import { quantity } from '@/domain/decimal'
import { convert, MissingRateError } from '@/domain/currency'
import type { ExchangeRate, InvestmentAsset, SavingsHolding } from '@/domain/entities'
import { valuateNetWorth, type ValuationPosition, type ValuationResult } from '@/domain/networth'
import { add, money, type CurrencyCode, type Money, zero } from '@/domain/money'
import { currentMonthStamp, monthRange, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'

export interface MonthSummary {
  expense: Money
  missingRateCount: number
}

/** Converts `amount` to `baseCurrency`, or returns undefined if no rate is
 *  available on or before `date` — callers count the miss instead of
 *  letting one bad conversion blank the whole report. */
function tryConvert(
  amount: Money,
  baseCurrency: CurrencyCode,
  rates: Awaited<ReturnType<typeof exchangeRatesRepo.listExchangeRates>>,
  date: DateStamp,
  profile: string | undefined,
): Money | undefined {
  try {
    return convert(amount, baseCurrency, rates, date, profile)
  } catch (error) {
    if (error instanceof MissingRateError) return undefined
    throw error // an unexpected error is a real bug — don't mask it as "missing rate"
  }
}

export async function getMonthSummary(month: MonthStamp): Promise<MonthSummary> {
  const { start, end } = monthRange(month)
  const [settings, expenses, rates] = await Promise.all([
    settingsRepo.getSettings(),
    expensesRepo.listExpensesInRange(start, end),
    exchangeRatesRepo.listExchangeRates(),
  ])
  const baseCurrency = settings.baseCurrency
  const profile = settings.rateProfile

  let expense = zero(baseCurrency)
  let missingRateCount = 0

  for (const item of expenses) {
    if (item.status !== 'confirmed') continue

    const converted = tryConvert(money(item.amount, item.currency), baseCurrency, rates, item.date, profile)
    if (!converted) {
      missingRateCount += 1
      continue
    }

    expense = add(expense, converted)
  }

  return { expense, missingRateCount }
}

export interface CategoryExpense {
  categoryId: string
  categoryName: string
  amount: Money
}

export interface ExpenseByCategory {
  items: CategoryExpense[]
  missingRateCount: number
}

export async function getExpenseByCategory(month: MonthStamp): Promise<ExpenseByCategory> {
  const { start, end } = monthRange(month)
  return getExpenseByCategoryInRange(start, end)
}

/** Same as getExpenseByCategory, but over an arbitrary date range — lets
 *  features/budgets reuse this for a yearly budget's spend-to-date
 *  without duplicating the expense scan + currency conversion. */
export async function getExpenseByCategoryInRange(start: DateStamp, end: DateStamp): Promise<ExpenseByCategory> {
  const [settings, expenses, rates, categories] = await Promise.all([
    settingsRepo.getSettings(),
    expensesRepo.listExpensesInRange(start, end),
    exchangeRatesRepo.listExchangeRates(),
    categoriesRepo.listCategories(),
  ])
  const baseCurrency = settings.baseCurrency
  const profile = settings.rateProfile
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const totals = new Map<string, number>()
  let missingRateCount = 0

  for (const item of expenses) {
    if (item.status !== 'confirmed') continue

    const converted = tryConvert(money(item.amount, item.currency), baseCurrency, rates, item.date, profile)
    if (!converted) {
      missingRateCount += 1
      continue
    }

    totals.set(item.categoryId, (totals.get(item.categoryId) ?? 0) + converted.amount)
  }

  const result: CategoryExpense[] = [...totals.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      categoryName: categoryById.get(categoryId)?.name ?? 'Categoría eliminada',
      amount: money(amountMinor, baseCurrency),
    }))
    .sort((a, b) => b.amount.amount - a.amount.amount)

  return { items: result, missingRateCount }
}

/**
 * Values Ahorros + Inversiones (current amount/quantity — neither has any
 * historical record of its own, see docs/DECISIONS.md "Evolución del
 * patrimonio: cantidades de hoy, precios de cada mes") revalued at
 * `asOfDate`'s own exchange rates and asset prices, which DO have real
 * history. `savings`/`holdings`/`assetById`/`rates` are fetched once by
 * the caller (they don't vary per point) — only the asset price lookup
 * is genuinely date-dependent. No Cuentas bucket — ver ADR
 * "Simplificación: se elimina Cuentas, Ingresos y Transferencias".
 */
async function netWorthAsOf(
  asOfDate: DateStamp,
  baseCurrency: CurrencyCode,
  rates: readonly ExchangeRate[],
  profile: string | undefined,
  savings: readonly SavingsHolding[],
  holdings: readonly { assetId: string; quantity: number }[],
  assetById: Map<string, InvestmentAsset>,
): Promise<{
  netWorth: Money
  byBucket: ValuationResult['byBucket']
  missingRateCount: number
  missingPriceCount: number
}> {
  const latestPrices = await assetPricesRepo.latestAssetPrices(
    holdings.map((h) => h.assetId),
    asOfDate,
  )

  const positions: ValuationPosition[] = holdings.map((holding) => {
    const asset = assetById.get(holding.assetId)
    const priceRow = asset ? latestPrices.get(asset.id) : undefined
    return {
      quantity: quantity(holding.quantity),
      ...(priceRow && { price: money(priceRow.price, priceRow.currency) }),
    }
  })

  const result = valuateNetWorth({
    savings,
    positions,
    rates,
    displayCurrency: baseCurrency,
    date: asOfDate,
    ...(profile !== undefined && { profile }),
  })

  return {
    netWorth: result.total,
    byBucket: result.byBucket,
    missingRateCount: result.missingRateCount,
    missingPriceCount: result.missingPriceCount,
  }
}

export interface NetWorthPoint {
  month: MonthStamp
  netWorth: Money
}

export interface NetWorthHistory {
  points: NetWorthPoint[]
  missingRateCount: number
  missingPriceCount: number
}

/** One point per month for the last `monthsBack` months, valued at
 *  month-end — except the current month, valued as of today, so the
 *  series never projects into the future. */
export async function getNetWorthHistory(monthsBack = 6): Promise<NetWorthHistory> {
  const settings = await settingsRepo.getSettings()
  const currentMonth = currentMonthStamp()

  const [rates, savings, holdings, assets] = await Promise.all([
    exchangeRatesRepo.listExchangeRates(),
    savingsHoldingsRepo.listSavingsHoldings(),
    investmentsRepo.listInvestmentHoldings(),
    investmentsRepo.listInvestmentAssets(),
  ])
  const assetById = new Map(assets.map((a) => [a.id, a]))

  const points: NetWorthPoint[] = []
  let missingRateCount = 0
  let missingPriceCount = 0

  for (let i = monthsBack - 1; i >= 0; i--) {
    const month = shiftMonth(currentMonth, -i)
    const asOfDate = i === 0 ? todayStamp() : monthRange(month).end
    const result = await netWorthAsOf(
      asOfDate,
      settings.baseCurrency,
      rates,
      settings.rateProfile,
      savings,
      holdings,
      assetById,
    )
    missingRateCount += result.missingRateCount
    missingPriceCount += result.missingPriceCount
    points.push({ month, netWorth: result.netWorth })
  }

  return { points, missingRateCount, missingPriceCount }
}

export interface ExpenseHistoryPoint {
  month: MonthStamp
  expense: Money
}

export interface ExpenseHistory {
  points: ExpenseHistoryPoint[]
  missingRateCount: number
}

/** One point per month for the `monthsBack` months ending at `anchorMonth`
 *  (defaults to the current month) — same shape/monthsBack default as
 *  getNetWorthHistory, for a "Gastos" trend chart. `anchorMonth` lets the
 *  Dashboard re-run this ending at whatever month its own month selector
 *  is set to, instead of always "now". Reuses getMonthSummary per month
 *  rather than re-deriving its scan+conversion logic; same accepted-cost
 *  tradeoff as getMonthlyReport (a few redundant settings/rates reads for
 *  one local user, in exchange for reusing already-tested code). */
export async function getExpenseHistory(monthsBack = 6, anchorMonth: MonthStamp = currentMonthStamp()): Promise<ExpenseHistory> {
  const points: ExpenseHistoryPoint[] = []
  let missingRateCount = 0

  for (let i = monthsBack - 1; i >= 0; i--) {
    const month = shiftMonth(anchorMonth, -i)
    const summary = await getMonthSummary(month)
    missingRateCount += summary.missingRateCount
    points.push({ month, expense: summary.expense })
  }

  return { points, missingRateCount }
}

export interface ReportCategoryRow {
  categoryId: string
  categoryName: string
  amount: Money
  /** This category's share of the month's total expense (0..1) — a
   *  display ratio, computed here so no component does arithmetic on a
   *  Minor amount (CLAUDE.md "Reglas financieras"). */
  share: number
}

export interface ReportNetWorth {
  asOfDate: DateStamp
  /** Same holdings, valued in each currency — the informe always shows
   *  ahorro e inversiones in both pesos and dólares, regardless of
   *  Settings.baseCurrency (that setting only governs the Gastos side of
   *  the report). */
  ars: { total: Money; byBucket: { savings: Money; investments: Money } }
  usd: { total: Money; byBucket: { savings: Money; investments: Money } }
  missingPriceCount: number
}

export interface MonthlyReport {
  month: MonthStamp
  baseCurrency: CurrencyCode
  /** Last day actually covered: month-end, or today for a month still in
   *  progress — same rule getNetWorthHistory uses for its last point. */
  coverageEnd: DateStamp
  isCurrentMonth: boolean
  generatedOn: DateStamp
  summary: MonthSummary
  categories: ReportCategoryRow[]
  /** Absent when nothing is tracked at all (no savings or investment
   *  positions) — the report then has no net worth section. */
  netWorth?: ReportNetWorth
  missingRateCount: number
}

/** Composes a "photo" of a single month — gastos, gasto por categoría, y
 *  (cuando hay algo que valuar) una foto del ahorro e inversiones — para el
 *  informe mensual imprimible. Pure composition over already-tested functions; no
 *  new domain logic. Accepted cost: getMonthSummary and getExpenseByCategory
 *  each independently re-read settings/rates/the month's expenses, so this
 *  does a few redundant local IndexedDB reads — reusing already-tested
 *  functions beats micro-optimizing reads that cost nothing noticeable for
 *  one local user. */
export async function getMonthlyReport(month: MonthStamp): Promise<MonthlyReport> {
  const today = todayStamp()
  const monthEnd = monthRange(month).end
  // DateStamps compare lexicographically — never value into the future.
  const coverageEnd = monthEnd > today ? today : monthEnd

  const [settings, summary, expenses, rates, savings, holdings, assets] = await Promise.all([
    settingsRepo.getSettings(),
    getMonthSummary(month),
    getExpenseByCategory(month),
    exchangeRatesRepo.listExchangeRates(),
    savingsHoldingsRepo.listSavingsHoldings(),
    investmentsRepo.listInvestmentHoldings(),
    investmentsRepo.listInvestmentAssets(),
  ])
  const assetById = new Map(assets.map((a) => [a.id, a]))
  const { baseCurrency, rateProfile } = settings

  // Ahorro e inversiones always reports in both ARS and USD (see
  // ReportNetWorth) — same holdings/prices, just valued twice.
  const [valuationArs, valuationUsd] = await Promise.all([
    netWorthAsOf(coverageEnd, 'ARS', rates, rateProfile, savings, holdings, assetById),
    netWorthAsOf(coverageEnd, 'USD', rates, rateProfile, savings, holdings, assetById),
  ])
  const tracksNetWorth = savings.length > 0 || holdings.length > 0

  const totalExpense = summary.expense.amount
  const categories: ReportCategoryRow[] = expenses.items.map((item) => ({
    ...item,
    share: totalExpense > 0 ? item.amount.amount / totalExpense : 0,
  }))

  const netWorth: ReportNetWorth | undefined = tracksNetWorth
    ? {
        asOfDate: coverageEnd,
        ars: { total: valuationArs.netWorth, byBucket: valuationArs.byBucket },
        usd: { total: valuationUsd.netWorth, byBucket: valuationUsd.byBucket },
        // Whether a position has any price loaded at all doesn't depend on
        // which currency it's then converted to — identical in both calls.
        missingPriceCount: valuationArs.missingPriceCount,
      }
    : undefined

  return {
    month,
    baseCurrency,
    coverageEnd,
    isCurrentMonth: month === currentMonthStamp(),
    generatedOn: today,
    summary,
    categories,
    // Same reasoning as ReportsPage: expenses' misses are a subset of
    // summary's (same scan, same conversion) — adding both would
    // double-count the same expense. The ARS and USD valuations are
    // independent conversions, though, so a rate missing for one but not
    // the other is two distinct misses, not a double-count.
    missingRateCount: summary.missingRateCount + valuationArs.missingRateCount + valuationUsd.missingRateCount,
    ...(netWorth && { netWorth }),
  }
}
