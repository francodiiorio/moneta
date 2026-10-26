import { invariant } from '@/lib/invariant'
import { add, money, negate, sub, type Money } from '@/domain/money'
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
  /** Spend already scheduled in the period but not happened yet —
   *  projected cuotas and recurring gastos still to come. Never part of
   *  `actual`, `percentUsed` or `isOverBudget`: it counts once its date
   *  comes (and a plan can still be edited, paused or deleted before
   *  then). In another currency, an estimate at today's rate. */
  committed: Money
  /** What's left once the committed spend lands too; negative when it
   *  would exceed the budget. */
  free: Money
  /** How far over the budget it ends up once `committed` lands too
   *  (already over or not); zero when it fits. */
  exceededBy: Money
  /** Display-only share of the budget `committed` takes, like
   *  `percentUsed`. */
  percentCommitted: number
}

export function calculateBudgetProgress(
  budget: Money,
  actual: Money,
  committed: Money = money(0, budget.currency),
): BudgetProgress {
  invariant(
    budget.currency === actual.currency && budget.currency === committed.currency,
    `Cannot compare budget progress across currencies: ${budget.currency} vs ${actual.currency} / ${committed.currency}`,
  )
  invariant(
    budget.amount >= 0 && actual.amount >= 0 && committed.amount >= 0,
    'Budget, actual and committed amounts must be non-negative',
  )

  const share = (part: Money) => (budget.amount === 0 ? (part.amount > 0 ? 100 : 0) : (part.amount / budget.amount) * 100)
  const remaining = sub(budget, actual)
  const free = sub(budget, add(actual, committed))

  return {
    budget,
    actual,
    remaining,
    percentUsed: share(actual),
    isOverBudget: actual.amount > budget.amount,
    committed,
    free,
    exceededBy: free.amount < 0 ? negate(free) : money(0, budget.currency),
    percentCommitted: share(committed),
  }
}
