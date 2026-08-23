import { budgetsRepo, categoriesRepo, exchangeRatesRepo, settingsRepo } from '@/database/repositories'
import { convert, MissingRateError } from '@/domain/currency'
import { calculateBudgetProgress, resolveActiveBudget, type BudgetProgress } from '@/domain/budgets'
import { money, parseAmount, type Money } from '@/domain/money'
import { currentMonthStamp, currentYearStamp, monthRange, todayStamp, yearRange, type MonthStamp } from '@/lib/dates'
import { getExpenseByCategoryInRange } from '@/features/reports/service'
import type { Budget } from '@/domain/entities'
import type { BudgetFormValues } from './schema'

export { listBudgets } from '@/database/repositories/budgets.repo'

export async function createBudgetFromForm(values: BudgetFormValues): Promise<Budget> {
  const settings = await settingsRepo.getSettings()
  const amount = parseAmount(values.amount, settings.baseCurrency)
  return budgetsRepo.createBudget({
    categoryId: values.categoryId,
    currency: settings.baseCurrency,
    period: values.period,
    amount: amount.amount,
    startsOn: values.startsOn,
  })
}

export async function removeBudget(id: string): Promise<void> {
  await budgetsRepo.deleteBudget(id)
}

export interface BudgetProgressItem {
  budgetId: string
  categoryId: string
  categoryName: string
  period: Budget['period']
  startsOn: Budget['startsOn']
  progress: BudgetProgress
}

export interface BudgetsWithProgress {
  items: BudgetProgressItem[]
  missingRateCount: number
}

/**
 * For every category+period that has at least one budget version,
 * resolves the version in effect and compares it to actual spend:
 * `monthly` budgets against `month` (the page's selected month);
 * `yearly` ones always against the current calendar year to date,
 * regardless of which month is being browsed.
 */
export async function getBudgetsWithProgress(month: MonthStamp): Promise<BudgetsWithProgress> {
  const [budgets, categories, settings, rates] = await Promise.all([
    budgetsRepo.listBudgets(),
    categoriesRepo.listCategories(),
    settingsRepo.getSettings(),
    exchangeRatesRepo.listExchangeRates(),
  ])
  const baseCurrency = settings.baseCurrency
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const pairs = new Map<string, { categoryId: string; period: Budget['period'] }>()
  for (const b of budgets) pairs.set(`${b.categoryId}:${b.period}`, { categoryId: b.categoryId, period: b.period })

  const currentMonth = currentMonthStamp()
  const hasMonthlyBudget = [...pairs.values()].some((p) => p.period === 'monthly')
  const hasYearlyBudget = [...pairs.values()].some((p) => p.period === 'yearly')

  // Only scan the ranges actually needed — the month range and the
  // current-year range usually overlap, so scanning both unconditionally
  // would double-count the same unconvertible transaction when only one
  // of the two periods is actually budgeted. This doesn't fully dedupe
  // when *both* a monthly and a yearly budget exist and the browsed month
  // falls in the current year (the common case): getExpenseByCategoryInRange
  // scans every confirmed expense transaction in its range, not just
  // budgeted categories, so ANY unconvertible transaction in the browsed
  // month — budgeted or not — is counted once by the month scan and again
  // by the year scan. Accepted as an informational-counter inaccuracy (it
  // never affects a Money value or a budget's own progress, only the
  // MissingRateBanner count); revisit if it proves confusing in practice.
  const monthBounds = monthRange(month)
  const yearBounds = yearRange(currentYearStamp())
  const [monthlyExpense, yearlyExpense] = await Promise.all([
    hasMonthlyBudget ? getExpenseByCategoryInRange(monthBounds.start, monthBounds.end) : undefined,
    hasYearlyBudget ? getExpenseByCategoryInRange(yearBounds.start, yearBounds.end) : undefined,
  ])
  const monthlyByCategory = new Map(monthlyExpense?.items.map((i) => [i.categoryId, i.amount]))
  const yearlyByCategory = new Map(yearlyExpense?.items.map((i) => [i.categoryId, i.amount]))

  let missingRateCount = (monthlyExpense?.missingRateCount ?? 0) + (yearlyExpense?.missingRateCount ?? 0)
  const items: BudgetProgressItem[] = []

  for (const { categoryId, period } of pairs.values()) {
    const asOfMonth = period === 'monthly' ? month : currentMonth
    const active = resolveActiveBudget(budgets, categoryId, period, asOfMonth)
    if (!active) continue

    const actualAmount = (period === 'monthly' ? monthlyByCategory : yearlyByCategory).get(categoryId) ?? money(0, baseCurrency)

    let budgetAmount: Money
    if (active.currency === baseCurrency) {
      budgetAmount = money(active.amount, active.currency)
    } else {
      // The budget was created under a base currency that's since
      // changed (Settings.baseCurrency can be edited any time) — convert
      // it to today's base currency, same missing-rate handling as
      // everywhere else in reports.
      try {
        budgetAmount = convert(money(active.amount, active.currency), baseCurrency, rates, todayStamp())
      } catch (error) {
        if (!(error instanceof MissingRateError)) throw error
        missingRateCount += 1
        continue
      }
    }

    items.push({
      budgetId: active.id,
      categoryId,
      categoryName: categoryById.get(categoryId)?.name ?? 'Categoría eliminada',
      period,
      startsOn: active.startsOn,
      progress: calculateBudgetProgress(budgetAmount, actualAmount),
    })
  }

  items.sort((a, b) => b.progress.percentUsed - a.progress.percentUsed)

  return { items, missingRateCount }
}
