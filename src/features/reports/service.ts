import { accountsRepo, categoriesRepo, exchangeRatesRepo, settingsRepo, transactionsRepo } from '@/database/repositories'
import { convert, MissingRateError } from '@/domain/currency'
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
): Money | undefined {
  try {
    return convert(amount, baseCurrency, rates, date)
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

    const converted = tryConvert(rawAmount, baseCurrency, rates, transaction.date)
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
  const [settings, items, rates, categories] = await Promise.all([
    settingsRepo.getSettings(),
    transactionsRepo.listTransactionsInRange(start, end),
    exchangeRatesRepo.listExchangeRates(),
    categoriesRepo.listCategories(),
  ])
  const baseCurrency = settings.baseCurrency
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

async function netWorthAsOf(asOfDate: DateStamp, baseCurrency: CurrencyCode): Promise<{ netWorth: Money; missingRateCount: number }> {
  const [accounts, rates] = await Promise.all([
    accountsRepo.listAccountsWithBalances(asOfDate),
    exchangeRatesRepo.listExchangeRates(),
  ])

  let total = zero(baseCurrency)
  let missingRateCount = 0
  for (const account of accounts) {
    const converted = tryConvert(money(account.balance, account.currency), baseCurrency, rates, asOfDate)
    if (!converted) {
      missingRateCount += 1
      continue
    }
    total = add(total, converted)
  }
  return { netWorth: total, missingRateCount }
}

export async function getCurrentNetWorth(): Promise<{ netWorth: Money; missingRateCount: number }> {
  const settings = await settingsRepo.getSettings()
  return netWorthAsOf(todayStamp(), settings.baseCurrency)
}

export interface NetWorthPoint {
  month: MonthStamp
  netWorth: Money
}

export interface NetWorthHistory {
  points: NetWorthPoint[]
  missingRateCount: number
}

/** One point per month for the last `monthsBack` months, valued at
 *  month-end — except the current month, valued as of today, so the
 *  series never projects into the future. */
export async function getNetWorthHistory(monthsBack = 6): Promise<NetWorthHistory> {
  const settings = await settingsRepo.getSettings()
  const currentMonth = currentMonthStamp()

  const points: NetWorthPoint[] = []
  let missingRateCount = 0

  for (let i = monthsBack - 1; i >= 0; i--) {
    const month = shiftMonth(currentMonth, -i)
    const asOfDate = i === 0 ? todayStamp() : monthRange(month).end
    const { netWorth, missingRateCount: monthMisses } = await netWorthAsOf(asOfDate, settings.baseCurrency)
    missingRateCount += monthMisses
    points.push({ month, netWorth })
  }

  return { points, missingRateCount }
}
