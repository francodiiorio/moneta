import {
  assetPricesRepo,
  categoriesRepo,
  exchangeRatesRepo,
  expensesRepo,
  incomesRepo,
  investmentLotsRepo,
  investmentsRepo,
  recurringPlansRepo,
  savingsHoldingsRepo,
  settingsRepo,
} from '@/database/repositories'
import { quantity } from '@/domain/decimal'
import { pendingOccurrencesInRange } from '@/domain/recurrence'
import { convert, MissingRateError } from '@/domain/currency'
import type { ExchangeRate, InvestmentAsset, InvestmentLot, SavingsHolding } from '@/domain/entities'
import { holdingsAsOf } from '@/domain/investments'
import { valuateNetWorth, type ValuationPosition, type ValuationResult } from '@/domain/networth'
import { add, money, sub, type CurrencyCode, type Money, zero } from '@/domain/money'
import { currentMonthStamp, monthRange, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
// Cuentas (Etapa 8) suman al patrimonio — re-using another feature's
// service is the established exception, see docs/DECISIONS.md "Un feature
// puede importar el service.ts/hooks de otro, nunca sus componentes".
import { getAccountBalancesAt } from '@/features/accounts/service'

export interface MonthSummary {
  /** Confirmed gastos of the month, by purchase date. */
  expense: Money
  /** Ingresos of the month. */
  income: Money
  /** Ingresos − gastos: what the month left (or cost) — not how the
   *  accounts' balances moved (transfers, card payments, investment
   *  purchases and adjustments are neither). */
  net: Money
  /** Gastos and ingresos left out for lack of an exchange rate. With any,
   *  `net` is partial — a missing ingreso can even flip its sign. */
  missingRateCount: number
  /** Of those, only gastos — for screens that show gastos alone. */
  expenseMissingRateCount: number
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
  const [settings, expenses, incomes, rates] = await Promise.all([
    settingsRepo.getSettings(),
    expensesRepo.listExpensesInRange(start, end),
    incomesRepo.listIncomesInRange(start, end),
    exchangeRatesRepo.listExchangeRates(),
  ])
  const baseCurrency = settings.baseCurrency
  const profile = settings.rateProfile

  function total(items: readonly { amount: number; currency: string; date: DateStamp }[]): { sum: Money; misses: number } {
    let sum = zero(baseCurrency)
    let misses = 0
    for (const item of items) {
      const converted = tryConvert(money(item.amount, item.currency), baseCurrency, rates, item.date, profile)
      if (!converted) {
        misses += 1
        continue
      }
      sum = add(sum, converted)
    }
    return { sum, misses }
  }

  const expense = total(expenses.filter((e) => e.status === 'confirmed'))
  const income = total(incomes)
  return {
    expense: expense.sum,
    income: income.sum,
    net: sub(income.sum, expense.sum),
    missingRateCount: expense.misses + income.misses,
    expenseMissingRateCount: expense.misses,
  }
}

export interface CategoryTotal {
  categoryId: string
  categoryName: string
  amount: Money
}

export interface CategoryBreakdown {
  items: CategoryTotal[]
  missingRateCount: number
}

export async function getExpenseByCategory(month: MonthStamp): Promise<CategoryBreakdown> {
  const { start, end } = monthRange(month)
  return getExpenseByCategoryInRange(start, end)
}

/** Ingresos of the month by income category — same shape as gastos. */
export async function getIncomeByCategory(month: MonthStamp): Promise<CategoryBreakdown> {
  const { start, end } = monthRange(month)
  return byCategory(await incomesRepo.listIncomesInRange(start, end))
}

/** Same as getExpenseByCategory, but over an arbitrary date range — lets
 *  features/budgets reuse this for a yearly budget's spend-to-date
 *  without duplicating the expense scan + currency conversion. */
export async function getExpenseByCategoryInRange(start: DateStamp, end: DateStamp): Promise<CategoryBreakdown> {
  const expenses = await expensesRepo.listExpensesInRange(start, end)
  return byCategory(expenses.filter((e) => e.status === 'confirmed'))
}

/**
 * For budgets: what was spent in the range (confirmed) and what's already
 * scheduled in it but hasn't happened yet — projected cuotas, and the
 * occurrences of active recurring plans not generated yet (a recurring
 * gasto only exists once its date comes). Expenses come from ONE read,
 * so a cuota confirmed in between can't show up in both or neither. In
 * another currency, a future one converts at the latest rate on or
 * before its date — today's: an estimate.
 */
export async function getSpentAndCommittedByCategoryInRange(
  start: DateStamp,
  end: DateStamp,
): Promise<{ spent: CategoryBreakdown; committed: CategoryBreakdown }> {
  const [expenses, plans, context] = await Promise.all([
    expensesRepo.listExpensesInRange(start, end),
    recurringPlansRepo.listRecurringPlans(),
    loadConversionContext(),
  ])
  const upcoming = plans
    .filter((plan) => !plan.isPaused)
    .flatMap((plan) =>
      pendingOccurrencesInRange(plan.rule, plan.lastMaterializedDate, start, end).map((date) => ({
        amount: plan.template.amount,
        currency: plan.template.currency,
        categoryId: plan.template.categoryId,
        date,
      })),
    )
  return {
    spent: totalsByCategory(context, expenses.filter((e) => e.status === 'confirmed')),
    committed: totalsByCategory(context, [...expenses.filter((e) => e.status === 'projected'), ...upcoming]),
  }
}

interface ConversionContext {
  settings: Awaited<ReturnType<typeof settingsRepo.getSettings>>
  rates: Awaited<ReturnType<typeof exchangeRatesRepo.listExchangeRates>>
  categories: Awaited<ReturnType<typeof categoriesRepo.listCategories>>
}

async function loadConversionContext(): Promise<ConversionContext> {
  const [settings, rates, categories] = await Promise.all([
    settingsRepo.getSettings(),
    exchangeRatesRepo.listExchangeRates(),
    categoriesRepo.listCategories(),
  ])
  return { settings, rates, categories }
}

/** Totals `items` per category in the base currency, biggest first. */
async function byCategory(
  items: readonly { amount: number; currency: string; date: DateStamp; categoryId: string }[],
): Promise<CategoryBreakdown> {
  return totalsByCategory(await loadConversionContext(), items)
}

function totalsByCategory(
  { settings, rates, categories }: ConversionContext,
  items: readonly { amount: number; currency: string; date: DateStamp; categoryId: string }[],
): CategoryBreakdown {
  const baseCurrency = settings.baseCurrency
  const profile = settings.rateProfile
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const totals = new Map<string, number>()
  let missingRateCount = 0

  for (const item of items) {
    const converted = tryConvert(money(item.amount, item.currency), baseCurrency, rates, item.date, profile)
    if (!converted) {
      missingRateCount += 1
      continue
    }

    totals.set(item.categoryId, add(money(totals.get(item.categoryId) ?? 0, baseCurrency), converted).amount)
  }

  const result: CategoryTotal[] = [...totals.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      categoryName: categoryById.get(categoryId)?.name ?? 'Categoría eliminada',
      amount: money(amountMinor, baseCurrency),
    }))
    .sort((a, b) => b.amount.amount - a.amount.amount)

  return { items: result, missingRateCount }
}

/**
 * Values Cuentas + Ahorros + Inversiones. Ahorros/Inversiones use their
 * current amount/quantity (neither has any historical record of its own,
 * see docs/DECISIONS.md "Evolución del patrimonio: cantidades de hoy,
 * precios de cada mes") revalued at `asOfDate`'s own exchange rates and
 * asset prices, which DO have real history. Cuentas do have history:
 * `accounts` is each open account's real balance at `asOfDate` (see
 * features/accounts/service.ts:getAccountBalancesAt).
 * `savings`/`holdings`/`assetById`/`rates` are fetched once by the caller
 * (they don't vary per point) — only the asset price lookup is genuinely
 * date-dependent.
 */
async function netWorthAsOf(
  asOfDate: DateStamp,
  baseCurrency: CurrencyCode,
  rates: readonly ExchangeRate[],
  profile: string | undefined,
  accounts: readonly Money[],
  savings: readonly SavingsHolding[],
  holdings: readonly { assetId: string; quantity: number }[],
  assetById: Map<string, InvestmentAsset>,
  sourcedLots: readonly InvestmentLot[],
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

  const positions: ValuationPosition[] = holdingsAsOf(holdings, sourcedLots, asOfDate).map((holding) => {
    const asset = assetById.get(holding.assetId)
    const priceRow = asset ? latestPrices.get(asset.id) : undefined
    return {
      quantity: quantity(holding.quantity),
      ...(priceRow && { price: money(priceRow.price, priceRow.currency) }),
    }
  })

  const result = valuateNetWorth({
    accounts,
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

  const [rates, savings, holdings, assets, sourcedLots] = await Promise.all([
    exchangeRatesRepo.listExchangeRates(),
    savingsHoldingsRepo.listSavingsHoldings(),
    investmentsRepo.listInvestmentHoldings(),
    investmentsRepo.listInvestmentAssets(),
    investmentLotsRepo.listLotsWithSource(),
  ])
  const assetById = new Map(assets.map((a) => [a.id, a]))

  const points: NetWorthPoint[] = []
  let missingRateCount = 0
  let missingPriceCount = 0

  const months = Array.from({ length: monthsBack }, (_, index) => shiftMonth(currentMonth, index - monthsBack + 1))
  const asOfDates = months.map((month) => (month === currentMonth ? todayStamp() : monthRange(month).end))
  const accountBalances = await getAccountBalancesAt(asOfDates)

  for (const [index, month] of months.entries()) {
    const asOfDate = asOfDates[index]!
    const result = await netWorthAsOf(
      asOfDate,
      settings.baseCurrency,
      rates,
      settings.rateProfile,
      accountBalances.get(asOfDate) ?? [],
      savings,
      holdings,
      assetById,
      sourcedLots,
    )
    missingRateCount += result.missingRateCount
    missingPriceCount += result.missingPriceCount
    points.push({ month, netWorth: result.netWorth })
  }

  return { points, missingRateCount, missingPriceCount }
}

export interface MonthFlowPoint {
  month: MonthStamp
  expense: Money
  income: Money
  net: Money
  /** Some movement of the month couldn't be converted: the figures are
   *  partial. */
  partial: boolean
}

export interface MonthFlowHistory {
  points: MonthFlowPoint[]
  missingRateCount: number
}

/** One point per month for the `monthsBack` months ending at `anchorMonth`
 *  (defaults to the current month) — same shape/monthsBack default as
 *  getNetWorthHistory, for the Dashboard's "Gastos" trend chart and the
 *  Reportes ingresos/gastos/balance table. `anchorMonth` lets the
 *  Dashboard re-run this ending at whatever month its own month selector
 *  is set to, instead of always "now". Reuses getMonthSummary per month
 *  rather than re-deriving its scan+conversion logic; same accepted-cost
 *  tradeoff as getMonthlyReport (a few redundant settings/rates reads for
 *  one local user, in exchange for reusing already-tested code). */
export async function getMonthFlowHistory(
  monthsBack = 6,
  anchorMonth: MonthStamp = currentMonthStamp(),
): Promise<MonthFlowHistory> {
  const points: MonthFlowPoint[] = []
  let missingRateCount = 0

  for (let i = monthsBack - 1; i >= 0; i--) {
    const month = shiftMonth(anchorMonth, -i)
    const summary = await getMonthSummary(month)
    missingRateCount += summary.missingRateCount
    points.push({
      month,
      expense: summary.expense,
      income: summary.income,
      net: summary.net,
      partial: summary.missingRateCount > 0,
    })
  }

  return { points, missingRateCount }
}

export interface ReportCategoryRow {
  categoryId: string
  categoryName: string
  amount: Money
  /** This category's share of the month's total — gastos or ingresos (0..1) — a
   *  display ratio, computed here so no component does arithmetic on a
   *  Minor amount (CLAUDE.md "Reglas financieras"). */
  share: number
}

export interface ReportNetWorth {
  asOfDate: DateStamp
  /** Same holdings, valued in each currency — the informe always shows
   *  the patrimonio (cuentas, ahorros, inversiones) in both pesos and dólares, regardless of
   *  Settings.baseCurrency (that setting only governs the Gastos side of
   *  the report). */
  ars: { total: Money; byBucket: ValuationResult['byBucket'] }
  usd: { total: Money; byBucket: ValuationResult['byBucket'] }
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
  expenseCategories: ReportCategoryRow[]
  /** Ingresos by category, `share` of the month's total income. */
  incomeCategories: ReportCategoryRow[]
  /** Absent when nothing is tracked at all (no open accounts, savings or
   *  investment positions) — the report then has no net worth section. */
  netWorth?: ReportNetWorth
  missingRateCount: number
}

/** Composes a "photo" of a single month — ingresos, gastos y balance, cada
 *  uno por categoría, y
 *  (cuando hay algo que valuar) una foto del patrimonio — para el
 *  informe mensual imprimible. Pure composition over already-tested functions; no
 *  new domain logic. Accepted cost: getMonthSummary and the by-category
 *  functions each independently re-read settings/rates/the month's expenses, so this
 *  does a few redundant local IndexedDB reads — reusing already-tested
 *  functions beats micro-optimizing reads that cost nothing noticeable for
 *  one local user. */
export async function getMonthlyReport(month: MonthStamp): Promise<MonthlyReport> {
  const today = todayStamp()
  const monthEnd = monthRange(month).end
  // DateStamps compare lexicographically — never value into the future.
  const coverageEnd = monthEnd > today ? today : monthEnd

  const [settings, summary, expenses, incomes, rates, savings, holdings, assets, accountBalances, sourcedLots] = await Promise.all([
    settingsRepo.getSettings(),
    getMonthSummary(month),
    getExpenseByCategory(month),
    getIncomeByCategory(month),
    exchangeRatesRepo.listExchangeRates(),
    savingsHoldingsRepo.listSavingsHoldings(),
    investmentsRepo.listInvestmentHoldings(),
    investmentsRepo.listInvestmentAssets(),
    getAccountBalancesAt([coverageEnd]),
    investmentLotsRepo.listLotsWithSource(),
  ])
  const accounts = accountBalances.get(coverageEnd) ?? []
  const assetById = new Map(assets.map((a) => [a.id, a]))
  const { baseCurrency, rateProfile } = settings

  // The patrimonio always reports in both ARS and USD (see
  // ReportNetWorth) — same holdings/prices, just valued twice.
  const [valuationArs, valuationUsd] = await Promise.all([
    netWorthAsOf(coverageEnd, 'ARS', rates, rateProfile, accounts, savings, holdings, assetById, sourcedLots),
    netWorthAsOf(coverageEnd, 'USD', rates, rateProfile, accounts, savings, holdings, assetById, sourcedLots),
  ])
  const tracksNetWorth = accounts.length > 0 || savings.length > 0 || holdings.length > 0

  const withShare = (items: readonly CategoryTotal[], total: Money): ReportCategoryRow[] =>
    items.map((item) => ({ ...item, share: total.amount > 0 ? item.amount.amount / total.amount : 0 }))
  const expenseCategories = withShare(expenses.items, summary.expense)
  const incomeCategories = withShare(incomes.items, summary.income)

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
    expenseCategories,
    incomeCategories,
    // Same reasoning as ReportsPage: the by-category misses are a subset of
    // summary's (same scans, same conversion) — adding both would
    // double-count the same movement. The ARS and USD valuations are
    // independent conversions, though, so a rate missing for one but not
    // the other is two distinct misses, not a double-count.
    missingRateCount: summary.missingRateCount + valuationArs.missingRateCount + valuationUsd.missingRateCount,
    ...(netWorth && { netWorth }),
  }
}
