import { sumMoney, type Money } from '@/domain/money'
import type { MonthStamp } from '@/lib/dates'

/** One cuota of a card installment plan, with the statement it's billed in. */
export interface BilledCuota {
  /** 0-based: cuota 1 is index 0. */
  index: number
  period: MonthStamp
  amount: Money
}

/** Where a card installment plan stands, the way the bank counts it. */
export type CardInstallmentStage =
  /** No cuota billed yet: the first left (`number`, 1-based) goes into
   *  `firstPeriod`. */
  | { kind: 'upcoming'; number: number; firstPeriod: MonthStamp }
  /** `number` (1-based) is the latest cuota billed — in the statement open
   *  today, or in an already closed one (`period`). */
  | { kind: 'billing'; number: number; period: MonthStamp; inOpenStatement: boolean }
  /** Every cuota sits in a closed statement. */
  | { kind: 'finished' }

export interface CardInstallmentProgress {
  stage: CardInstallmentStage
  /** Cuotas already in a statement, the open one included. */
  billedCount: number
  /** Cuotas in statements after the open one, and what they add up to. */
  unbilledCount: number
  unbilled: Money
}

/**
 * The bank's view of a card installment plan: a cuota counts once it's in
 * a statement — the one open today included — not when its own date
 * comes. "Cuota 2/6" is the one being billed now. (Each cuota still counts
 * as a gasto on its date for budgets and reports — a separate question.)
 */
export function cardInstallmentProgress(
  cuotas: readonly BilledCuota[],
  openPeriod: MonthStamp,
  currency: string,
): CardInstallmentProgress {
  const billed = cuotas.filter((c) => c.period <= openPeriod)
  const unbilled = cuotas.filter((c) => c.period > openPeriod)
  const progress = {
    billedCount: billed.length,
    unbilledCount: unbilled.length,
    unbilled: sumMoney(currency, unbilled.map((c) => c.amount)),
  }

  if (billed.length === 0) {
    const first = unbilled.reduce<BilledCuota | undefined>(
      (min, c) => (min === undefined || c.period < min.period || (c.period === min.period && c.index < min.index) ? c : min),
      undefined,
    )
    return {
      ...progress,
      stage: first === undefined ? { kind: 'finished' } : { kind: 'upcoming', number: first.index + 1, firstPeriod: first.period },
    }
  }
  const latest = billed.reduce((a, b) => (b.period > a.period || (b.period === a.period && b.index > a.index) ? b : a))
  if (unbilled.length === 0 && latest.period < openPeriod) return { ...progress, stage: { kind: 'finished' } }
  return {
    ...progress,
    stage: { kind: 'billing', number: latest.index + 1, period: latest.period, inOpenStatement: latest.period === openPeriod },
  }
}
