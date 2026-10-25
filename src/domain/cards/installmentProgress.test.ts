import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import { cardInstallmentProgress, type BilledCuota } from './installmentProgress'

/** Six cuotas of 88.040, the first in `firstPeriod`, one per statement. */
function plan(firstPeriod: string): BilledCuota[] {
  const [year, month] = firstPeriod.split('-').map(Number) as [number, number]
  return Array.from({ length: 6 }, (_, index) => {
    const m = month - 1 + index
    const period = `${year + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`
    return { index, period, amount: money(88_040_00, 'ARS') }
  })
}

describe('cardInstallmentProgress', () => {
  it('counts like the bank: cuota 2/6 is the one in the statement open today', () => {
    // Bought Sep 30, after September's close: cuota 1 in October's
    // statement (already closed), cuota 2 in November's (open).
    const progress = cardInstallmentProgress(plan('2026-10'), '2026-11', 'ARS')
    expect(progress.stage).toEqual({ kind: 'billing', number: 2, period: '2026-11', inOpenStatement: true })
    expect(progress.billedCount).toBe(2)
    expect(progress.unbilledCount).toBe(4)
    expect(progress.unbilled).toEqual(money(4 * 88_040_00, 'ARS'))
  })

  it('before the first cuota is billed: which statement it goes into', () => {
    const progress = cardInstallmentProgress(plan('2026-12'), '2026-11', 'ARS')
    expect(progress.stage).toEqual({ kind: 'upcoming', number: 1, firstPeriod: '2026-12' })
    expect(progress.billedCount).toBe(0)
    expect(progress.unbilled).toEqual(money(6 * 88_040_00, 'ARS'))
  })

  it('the last cuota in the open statement is still being billed; once its statement closes, finished', () => {
    expect(cardInstallmentProgress(plan('2026-06'), '2026-11', 'ARS').stage).toEqual({
      kind: 'billing',
      number: 6,
      period: '2026-11',
      inOpenStatement: true,
    })
    const done = cardInstallmentProgress(plan('2026-06'), '2026-12', 'ARS')
    expect(done.stage).toEqual({ kind: 'finished' })
    expect(done.unbilled).toEqual(money(0, 'ARS'))
  })

  it('a gap in the statements (a cuota deleted) keeps the latest billed number', () => {
    const cuotas = plan('2026-10').filter((c) => c.index !== 1)
    expect(cardInstallmentProgress(cuotas, '2026-11', 'ARS').stage).toEqual({
      kind: 'billing',
      number: 1,
      period: '2026-10',
      inOpenStatement: false,
    })
  })

  it('upcoming names the first cuota left, even when an earlier one was deleted', () => {
    const cuotas = plan('2026-12').filter((c) => c.index !== 0)
    expect(cardInstallmentProgress(cuotas, '2026-11', 'ARS').stage).toEqual({ kind: 'upcoming', number: 2, firstPeriod: '2027-01' })
  })
})
