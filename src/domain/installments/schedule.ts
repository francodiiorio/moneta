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

/** Combines a plan's frozen `scheduleCache` with its due dates. */
export function buildInstallmentSchedule(plan: InstallmentPlan): InstallmentOccurrence[] {
  const dueDates = installmentDueDates(plan.firstDueDate, plan.count)
  return plan.scheduleCache.map((amount, index) => ({
    index,
    dueDate: dueDates[index]!,
    amount: minor(amount),
  }))
}
