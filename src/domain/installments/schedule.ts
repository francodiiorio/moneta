import { addMonths } from 'date-fns'
import { allocate, minor, type Minor } from '@/domain/money'
import { fromDateStamp, toDateStamp, type DateStamp } from '@/lib/dates'
import type { InstallmentPlan } from '@/domain/entities'

/** Splits `total` into `count` equal-weight shares via the largest-remainder
 *  method (`allocate`) — guarantees `sum(result) === total` exactly, even
 *  when `total` isn't a multiple of `count`. This is what gets frozen into
 *  `InstallmentPlan.scheduleCache` at creation time. */
export function installmentAmounts(total: Minor, count: number): Minor[] {
  return allocate(total, Array<number>(count).fill(1))
}

/** One due date per month starting at `firstDueDate`, computed fresh from
 *  that anchor for each index (same reasoning as domain/recurrence) so a
 *  plan anchored on the 31st doesn't drift after a short month. */
export function installmentDueDates(firstDueDate: DateStamp, count: number): DateStamp[] {
  const anchor = fromDateStamp(firstDueDate)
  return Array.from({ length: count }, (_, index) => toDateStamp(addMonths(anchor, index)))
}

export interface InstallmentOccurrence {
  index: number
  dueDate: DateStamp
  amount: Minor
}

/**
 * Combines a plan's frozen `scheduleCache` with its due dates. `firstDueDate`
 * is the due date of the first cuota Moneta tracks — cuota 1, or for a plan
 * without a card already under way, cuota `startIndex + 1` (the date the
 * user gave). Each date is computed fresh from that anchor, never derived
 * backwards and forwards again: "the 31st" stays the 31st where the month
 * has one. (A card plan's cuotas are dated by their statements instead —
 * domain/cards:installmentPlacement.)
 */
export function buildInstallmentSchedule(plan: InstallmentPlan): InstallmentOccurrence[] {
  const offset = plan.cardId === undefined ? (plan.startIndex ?? 0) : 0
  const anchor = fromDateStamp(plan.firstDueDate)
  return plan.scheduleCache.map((amount, index) => ({
    index,
    dueDate: toDateStamp(addMonths(anchor, index - offset)),
    amount: minor(amount),
  }))
}
