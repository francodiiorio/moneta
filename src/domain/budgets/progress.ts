import { invariant } from '@/lib/invariant'
import { sub, type Money } from '@/domain/money'
import type { Budget } from '@/domain/entities'
import type { MonthStamp } from '@/lib/dates'

/**
 * Picks the budget in effect for `categoryId`+`period` at `asOfMonth`:
 * the one with the most recent `startsOn` that is `<= asOfMonth`. A
 * budget dated in the future (relative to `asOfMonth`) isn't in effect
 * yet — see docs/DATA_MODEL.md "editar un presupuesto crea una versión
 * nueva en vez de mutar el monto".
 *
 * `createBudget` rejects a duplicate `(categoryId, period, startsOn)`
 * going forward, but an imported backup could still contain one — on a
 * tie, `id` (a chronologically-ordered ULID, see lib/ids.ts) breaks it
 * so the most recently created version wins, instead of array order.
 */
export function resolveActiveBudget(
  budgets: readonly Budget[],
  categoryId: string,
  period: Budget['period'],
  asOfMonth: MonthStamp,
): Budget | undefined {
  return budgets
    .filter((b) => b.categoryId === categoryId && b.period === period && b.startsOn <= asOfMonth)
    .reduce<Budget | undefined>(
      (latest, b) =>
        !latest || b.startsOn > latest.startsOn || (b.startsOn === latest.startsOn && b.id > latest.id)
          ? b
          : latest,
      undefined,
    )
}

export interface BudgetProgress {
  budget: Money
  actual: Money
  remaining: Money
  /** Derived float for display only (progress bar, badge) — never
   *  stored or fed back into a monetary calculation, same exception as
   *  formatMoney. Can exceed 100. */
  percentUsed: number
  isOverBudget: boolean
}

export function calculateBudgetProgress(budget: Money, actual: Money): BudgetProgress {
  invariant(
    budget.currency === actual.currency,
    `Cannot compare budget progress across currencies: ${budget.currency} vs ${actual.currency}`,
  )
  invariant(budget.amount >= 0 && actual.amount >= 0, 'Budget and actual amounts must be non-negative')

  const percentUsed = budget.amount === 0 ? (actual.amount > 0 ? 100 : 0) : (actual.amount / budget.amount) * 100

  return {
    budget,
    actual,
    remaining: sub(budget, actual),
    percentUsed,
    isOverBudget: actual.amount > budget.amount,
  }
}
