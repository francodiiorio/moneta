import {
  accountsRepo,
  assetPricesRepo,
  categoriesRepo,
  exchangeRatesRepo,
  investmentsRepo,
  savingsHoldingsRepo,
  settingsRepo,
  transactionsRepo,
} from '@/database/repositories'
import { quantity } from '@/domain/decimal'
import { convert, MissingRateError } from '@/domain/currency'
import type { ExchangeRate, InvestmentAsset, SavingsHolding } from '@/domain/entities'
import { valuateNetWorth, type ValuationPosition, type ValuationResult } from '@/domain/networth'
import { add, money, sub, zero, type CurrencyCode, type Money } from '@/domain/money'
import { currentMonthStamp, monthRange, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'

export interface MonthSummary {
  income: Money
  expense: Money
  net: Money
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
  const [settings, items, rates] = await Promise.all([
    settingsRepo.getSettings(),
    transactionsRepo.listTransactionsInRange(start, end),
    exchangeRatesRepo.listExchangeRates(),
  ])
  const baseCurrency = settings.baseCurrency
  const profile = settings.rateProfile

  let income = zero(baseCurrency)
  let expense = zero(baseCurrency)
  let missingRateCount = 0

  for (const { transaction, postings } of items) {
    if (transaction.status !== 'confirmed') continue
    if (transaction.kind !== 'expense' && transaction.kind !== 'income') continue

    const categoryPosting = postings.find((p) => p.target === 'category')
    if (!categoryPosting) continue

    // Expense category postings are positive, income ones negative (see
    // domain/ledger/builders.ts) — flip income back to a positive amount.
    const rawAmount =
      transaction.kind === 'expense'
        ? money(categoryPosting.amount, categoryPosting.currency)
        : money(-categoryPosting.amount, categoryPosting.currency)

    const converted = tryConvert(rawAmount, baseCurrency, rates, transaction.date, profile)
    if (!converted) {
      missingRateCount += 1
      continue
    }

    if (transaction.kind === 'expense') expense = add(expense, converted)
    else income = add(income, converted)
  }

  return { income, expense, net: sub(income, expense), missingRateCount }
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
 *  without duplicating the transaction scan + currency conversion. */
export async function getExpenseByCategoryInRange(start: DateStamp, end: DateStamp): Promise<ExpenseByCategory> {
  const [settings, items, rates, categories] = await Promise.all([
    settingsRepo.getSettings(),
    transactionsRepo.listTransactionsInRange(start, end),
    exchangeRatesRepo.listExchangeRates(),
    categoriesRepo.listCategories(),
  ])
  const baseCurrency = settings.baseCurrency
  const profile = settings.rateProfile
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const totals = new Map<string, number>()
  let missingRateCount = 0

  for (const { transaction, postings } of items) {
    if (transaction.status !== 'confirmed' || transaction.kind !== 'expense') continue
    const categoryPosting = postings.find((p) => p.target === 'category')
    if (!categoryPosting?.categoryId) continue

    const converted = tryConvert(
      money(categoryPosting.amount, categoryPosting.currency),
      baseCurrency,
      rates,
      transaction.date,
      profile,
    )
    if (!converted) {
      missingRateCount += 1
      continue
    }

    totals.set(categoryPosting.categoryId, (totals.get(categoryPosting.categoryId) ?? 0) + converted.amount)
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
 * Values Cuentas (real historical balance from the ledger, as of
 * `asOfDate`) + Ahorros + Inversiones (current amount/quantity — neither
 * has any historical record of its own, see docs/DECISIONS.md "Evolución
 * del patrimonio: cantidades de hoy, precios de cada mes") revalued at
 * `asOfDate`'s own exchange rates and asset prices, which DO have real
 * history. `savings`/`holdings`/`assetById`/`rates` are fetched once by
 * the caller (they don't vary per point) — only the asset price lookup
 * is genuinely date-dependent.
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
  accountCount: number
  missingRateCount: number
  missingPriceCount: number
}> {
  const accounts = await accountsRepo.listAccountsWithBalances(asOfDate)
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
    accounts: accounts.map((a) => ({ balance: a.balance, currency: a.currency })),
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
    accountCount: accounts.length,
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
  total: Money
  byBucket: { accounts: Money; savings: Money; investments: Money }
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
  /** Absent when nothing is tracked at all (no accounts, savings, or
   *  investment positions) — the report then has no net worth section. */
  netWorth?: ReportNetWorth
  missingRateCount: number
}

/** Composes a "photo" of a single month — income/expense, expense by
 *  category, and (when there's anything to value) a net worth snapshot —
 *  for the printable monthly report. Pure composition over already-tested
 *  functions; no new domain logic. Accepted cost: getMonthSummary and
 *  getExpenseByCategory each independently re-read settings/rates/the
 *  month's transactions, so this does a few redundant local IndexedDB
 *  reads — reusing already-tested functions beats micro-optimizing reads
 *  that cost nothing noticeable for one local user. */
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

  const valuation = await netWorthAsOf(coverageEnd, baseCurrency, rates, rateProfile, savings, holdings, assetById)
  const tracksNetWorth = valuation.accountCount > 0 || savings.length > 0 || holdings.length > 0

  const totalExpense = summary.expense.amount
  const categories: ReportCategoryRow[] = expenses.items.map((item) => ({
    ...item,
    share: totalExpense > 0 ? item.amount.amount / totalExpense : 0,
  }))

  const netWorth: ReportNetWorth | undefined = tracksNetWorth
    ? {
        asOfDate: coverageEnd,
        total: valuation.netWorth,
        byBucket: valuation.byBucket,
        missingPriceCount: valuation.missingPriceCount,
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
    // double-count the same transaction.
    missingRateCount: summary.missingRateCount + valuation.missingRateCount,
    ...(netWorth && { netWorth }),
  }
}
