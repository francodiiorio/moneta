import { budgetsRepo, categoriesRepo, exchangeRatesRepo, settingsRepo } from '@/database/repositories'
import { convert, MissingRateError } from '@/domain/currency'
import { calculateBudgetProgress, resolveActiveBudget, type BudgetProgress } from '@/domain/budgets'
import { money, parseAmount, type Money } from '@/domain/money'
import { currentMonthStamp, currentYearStamp, monthRange, todayStamp, yearRange, type MonthStamp } from '@/lib/dates'
import { getSpentAndCommittedByCategoryInRange } from '@/features/reports/service'
import type { Budget } from '@/domain/entities'
import type { BudgetEditFormValues, BudgetFormValues } from './schema'

export { listBudgets } from '@/database/repositories/budgets.repo'

/** From this share of a budget used, it's flagged as close to its limit. */
export const BUDGET_NEAR_LIMIT_PERCENT = 90

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

/** See budgetsRepo.setBudgetAmountFrom: a correction for the version
 *  starting that month, else a new version from it. */
export async function editBudgetFromForm(
  budget: Pick<Budget, 'categoryId' | 'period'>,
  values: BudgetEditFormValues,
): Promise<Budget> {
  const settings = await settingsRepo.getSettings()
  const amount = parseAmount(values.amount, settings.baseCurrency)
  return budgetsRepo.setBudgetAmountFrom({
    categoryId: budget.categoryId,
    period: budget.period,
    currency: settings.baseCurrency,
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
  categoryColor?: string
  categoryIcon?: string
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
 * regardless of which month is being browsed. Committed spend (projected
 * cuotas, see BudgetProgress.committed) covers the same range — for a
 * yearly budget, the cuotas still to come for the rest of the year.
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
  // falls in the current year (the common case): each scan converts every
  // expense in its range — confirmed and projected, not just budgeted
  // categories — so ANY unconvertible one in the browsed month is counted
  // once by the month scan and again by the year scan. Accepted as an
  // informational-counter inaccuracy (it never affects a Money value or a
  // budget's own progress, only the MissingRateBanner count — though a
  // projected cuota left out for lack of a rate does make `free` look
  // bigger, which the banner is there to flag); revisit if it proves
  // confusing in practice.
  const monthBounds = monthRange(month)
  const yearBounds = yearRange(currentYearStamp())
  const [monthly, yearly] = await Promise.all([
    hasMonthlyBudget ? getSpentAndCommittedByCategoryInRange(monthBounds.start, monthBounds.end) : undefined,
    hasYearlyBudget ? getSpentAndCommittedByCategoryInRange(yearBounds.start, yearBounds.end) : undefined,
  ])
  const monthlyByCategory = new Map(monthly?.spent.items.map((i) => [i.categoryId, i.amount]))
  const yearlyByCategory = new Map(yearly?.spent.items.map((i) => [i.categoryId, i.amount]))
  const monthlyCommitted = new Map(monthly?.committed.items.map((i) => [i.categoryId, i.amount]))
  const yearlyCommitted = new Map(yearly?.committed.items.map((i) => [i.categoryId, i.amount]))

  let missingRateCount = [monthly, yearly].reduce(
    (count, scan) => count + (scan?.spent.missingRateCount ?? 0) + (scan?.committed.missingRateCount ?? 0),
    0,
  )
  const items: BudgetProgressItem[] = []

  for (const { categoryId, period } of pairs.values()) {
    const asOfMonth = period === 'monthly' ? month : currentMonth
    const active = resolveActiveBudget(budgets, categoryId, period, asOfMonth)
    if (!active) continue

    const actualAmount = (period === 'monthly' ? monthlyByCategory : yearlyByCategory).get(categoryId) ?? money(0, baseCurrency)
    const committedAmount = (period === 'monthly' ? monthlyCommitted : yearlyCommitted).get(categoryId) ?? money(0, baseCurrency)

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

    const category = categoryById.get(categoryId)
    items.push({
      budgetId: active.id,
      categoryId,
      categoryName: category?.name ?? 'Categoría eliminada',
      ...(category?.color !== undefined && { categoryColor: category.color }),
      ...(category?.icon !== undefined && { categoryIcon: category.icon }),
      period,
      startsOn: active.startsOn,
      progress: calculateBudgetProgress(budgetAmount, actualAmount, committedAmount),
    })
  }

  items.sort((a, b) => b.progress.percentUsed - a.progress.percentUsed)

  return { items, missingRateCount }
}
