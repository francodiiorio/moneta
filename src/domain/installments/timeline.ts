import { sumMoney, type Money } from '@/domain/money'
import { shiftMonth, type MonthStamp } from '@/lib/dates'

export interface TimelineCuota {
  planId: string
  /** The month it's paid in (a card cuota: its statement's due month). */
  month: MonthStamp
  amount: Money
}

export interface CuotaMonth {
  month: MonthStamp
  /** One per currency, by currency code — never added across currencies.
   *  Empty for a month with no cuotas between two that have some. */
  totals: Money[]
  /** Plans whose last cuota is this month. */
  endingPlanIds: string[]
}

export interface CuotaTimeline {
  /** Every month from `from` through the last cuota, gaps included. */
  months: CuotaMonth[]
  /** The first month with no cuota left; undefined with none ahead. */
  freeFrom: MonthStamp | undefined
}

/** The cuotas still to pay, month by month from `from`, and the month
 *  they're all paid. */
export function cuotaTimeline(cuotas: readonly TimelineCuota[], from: MonthStamp): CuotaTimeline {
  const ahead = cuotas.filter((c) => c.month >= from)
  if (ahead.length === 0) return { months: [], freeFrom: undefined }

  const lastByPlan = new Map<string, MonthStamp>()
  const byMonth = new Map<MonthStamp, Map<string, Money[]>>()
  for (const cuota of ahead) {
    if ((lastByPlan.get(cuota.planId) ?? '') < cuota.month) lastByPlan.set(cuota.planId, cuota.month)
    const byCurrency = byMonth.get(cuota.month) ?? new Map<string, Money[]>()
    byCurrency.set(cuota.amount.currency, [...(byCurrency.get(cuota.amount.currency) ?? []), cuota.amount])
    byMonth.set(cuota.month, byCurrency)
  }
  const last = [...lastByPlan.values()].reduce((a, b) => (a > b ? a : b))

  const months: CuotaMonth[] = []
  for (let month = from; month <= last; month = shiftMonth(month, 1)) {
    const byCurrency = byMonth.get(month) ?? new Map<string, Money[]>()
    months.push({
      month,
      totals: [...byCurrency.keys()].sort().map((currency) => sumMoney(currency, byCurrency.get(currency) ?? [])),
      endingPlanIds: [...lastByPlan].filter(([, end]) => end === month).map(([planId]) => planId),
    })
  }
  return { months, freeFrom: shiftMonth(last, 1) }
}
