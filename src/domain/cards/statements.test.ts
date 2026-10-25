import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import {
  installmentPlacement,
  lastPurchaseDay,
  openStatement,
  reassignedPeriods,
  statementDates,
  statementOverrideProblem,
  statementPeriodFor,
  statementTotals,
  type CardCalendar,
} from './statements'

const visa: CardCalendar = { card: { closingDay: 25, dueDay: 5 }, overrides: [] }

describe('statementDates', () => {
  it('closes on closingDay of the period; due falls next month when dueDay comes first', () => {
    expect(statementDates(visa, '2026-10')).toEqual({ period: '2026-10', closeDate: '2026-10-25', dueDate: '2026-11-05' })
  })

  it('due stays in the same month when dueDay comes after the close', () => {
    const card: CardCalendar = { card: { closingDay: 5, dueDay: 15 }, overrides: [] }
    expect(statementDates(card, '2026-10')).toEqual({ period: '2026-10', closeDate: '2026-10-05', dueDate: '2026-10-15' })
  })

  it('clamps day 31 to short months', () => {
    const card: CardCalendar = { card: { closingDay: 31, dueDay: 10 }, overrides: [] }
    expect(statementDates(card, '2026-02')).toEqual({ period: '2026-02', closeDate: '2026-02-28', dueDate: '2026-03-10' })
  })

  it('uses the hand-corrected dates of an overridden period, only for that period', () => {
    const cal: CardCalendar = { ...visa, overrides: [{ period: '2026-10', closeDate: '2026-10-29', dueDate: '2026-11-09' }] }
    expect(statementDates(cal, '2026-10')).toEqual({ period: '2026-10', closeDate: '2026-10-29', dueDate: '2026-11-09' })
    expect(statementDates(cal, '2026-11').closeDate).toBe('2026-11-25')
  })
})

describe('statementPeriodFor', () => {
  it('a purchase before or on the closing day goes into that month’s statement', () => {
    expect(statementPeriodFor(visa, '2026-10-01')).toBe('2026-10')
    expect(statementPeriodFor(visa, '2026-10-25')).toBe('2026-10')
  })

  it('a purchase after the close goes into the next one', () => {
    expect(statementPeriodFor(visa, '2026-10-26')).toBe('2026-11')
    expect(statementPeriodFor(visa, '2026-12-31')).toBe('2027-01')
  })

  it('follows an override that moves the close earlier or later', () => {
    const earlier: CardCalendar = { ...visa, overrides: [{ period: '2026-10', closeDate: '2026-10-22', dueDate: '2026-11-03' }] }
    expect(statementPeriodFor(earlier, '2026-10-23')).toBe('2026-11')
    const later: CardCalendar = { ...visa, overrides: [{ period: '2026-10', closeDate: '2026-10-28', dueDate: '2026-11-08' }] }
    expect(statementPeriodFor(later, '2026-10-27')).toBe('2026-10')
  })

  it('a close moved into the next month still captures the first days of that month', () => {
    const cal: CardCalendar = { card: { closingDay: 30, dueDay: 10 }, overrides: [{ period: '2026-09', closeDate: '2026-10-02', dueDate: '2026-10-12' }] }
    expect(statementPeriodFor(cal, '2026-10-01')).toBe('2026-09')
    expect(statementPeriodFor(cal, '2026-10-03')).toBe('2026-10')
  })
})

describe('openStatement', () => {
  it('is the statement today’s purchases go into', () => {
    expect(openStatement(visa, '2026-10-23')).toEqual({ period: '2026-10', closeDate: '2026-10-25', dueDate: '2026-11-05' })
    expect(openStatement(visa, '2026-10-26').period).toBe('2026-11')
  })
})

describe('statementTotals', () => {
  it('sums per currency, never mixing them, sorted', () => {
    const totals = statementTotals([
      { amount: 1_000_00, currency: 'USD' },
      { amount: 50_000_00, currency: 'ARS' },
      { amount: 2_50, currency: 'USD' },
      { amount: 25_000_00, currency: 'ARS' },
    ])
    expect(totals).toEqual([money(75_000_00, 'ARS'), money(1_002_50, 'USD')])
  })

  it('is empty for no expenses', () => {
    expect(statementTotals([])).toEqual([])
  })
})

describe('reassignedPeriods', () => {
  const after: CardCalendar = { ...visa, overrides: [{ period: '2026-10', closeDate: '2026-10-22', dueDate: '2026-11-03' }] }

  it('moves an automatically placed expense whose statement changed', () => {
    expect(reassignedPeriods([{ id: 'e1', date: '2026-10-24', statementPeriod: '2026-10' }], visa, after)).toEqual([
      { id: 'e1', statementPeriod: '2026-11' },
    ])
  })

  it('leaves one that stays in the same statement', () => {
    expect(reassignedPeriods([{ id: 'e1', date: '2026-10-10', statementPeriod: '2026-10' }], visa, after)).toEqual([])
  })

  it('leaves one the user placed by hand (not where automatic placement would put it)', () => {
    // A late presentation: bought Oct 10, billed in November's statement.
    expect(reassignedPeriods([{ id: 'e1', date: '2026-10-10', statementPeriod: '2026-11' }], visa, after)).toEqual([])
  })
})

describe('statementOverrideProblem', () => {
  it('accepts a close moved a few days within the period or into the next month', () => {
    expect(statementOverrideProblem(visa, '2026-10', '2026-10-22', '2026-11-03')).toBeUndefined()
    expect(statementOverrideProblem(visa, '2026-10', '2026-11-02', '2026-11-12')).toBeUndefined()
  })

  it('rejects a mistyped year or month (outside the period and the next one)', () => {
    expect(statementOverrideProblem(visa, '2026-10', '2025-10-25', '2025-11-05')).toMatch(/ese mes o en el siguiente/)
    expect(statementOverrideProblem(visa, '2026-10', '2026-12-01', '2026-12-10')).toMatch(/ese mes o en el siguiente/)
  })

  it('rejects a close on or past the next period’s close, or on/before the previous one', () => {
    // November closes Nov 25 by default.
    expect(statementOverrideProblem(visa, '2026-10', '2026-11-25', '2026-12-05')).toMatch(/antes del siguiente/)
    const cal: CardCalendar = { ...visa, overrides: [{ period: '2026-09', closeDate: '2026-10-02', dueDate: '2026-10-12' }] }
    expect(statementOverrideProblem(cal, '2026-10', '2026-10-01', '2026-10-15')).toMatch(/después del cierre del resumen anterior/)
  })

  it('rejects a due date before the close, and invalid dates', () => {
    expect(statementOverrideProblem(visa, '2026-10', '2026-10-25', '2026-10-24')).toMatch(/vencimiento/)
    expect(statementOverrideProblem(visa, '2026-10', '2026-02-31', '2026-03-05')).toMatch(/inválida/)
  })
})

describe('installmentPlacement', () => {
  const all = (cal: CardCalendar, purchase: string, count: number) =>
    Array.from({ length: count }, (_, i) => installmentPlacement(cal, purchase, i))

  it('one cuota per statement, starting at the purchase’s, dated the purchase day', () => {
    expect(all(visa, '2026-10-10', 3)).toEqual([
      { period: '2026-10', date: '2026-10-10' },
      { period: '2026-11', date: '2026-11-10' },
      { period: '2026-12', date: '2026-12-10' },
    ])
  })

  it('a purchase after the close starts on the next statement', () => {
    expect(all(visa, '2026-10-26', 2).map((p) => p.period)).toEqual(['2026-11', '2026-12'])
  })

  it('a close moved before the cuota’s day keeps it in its statement, dated at the close', () => {
    const cal: CardCalendar = { ...visa, overrides: [{ period: '2026-11', closeDate: '2026-11-08', dueDate: '2026-11-18' }] }
    expect(all(cal, '2026-10-10', 3)).toEqual([
      { period: '2026-10', date: '2026-10-10' },
      { period: '2026-11', date: '2026-11-08' },
      { period: '2026-12', date: '2026-12-10' },
    ])
  })

  it('every cuota stays at or before its statement’s close (never billed in a closed one)', () => {
    const cal: CardCalendar = { card: { closingDay: 5, dueDay: 15 }, overrides: [] }
    for (const { period, date } of all(cal, '2026-01-31', 6)) {
      expect(date <= statementDates(cal, period).closeDate).toBe(true)
    }
  })
})

describe('compras del día de cierre al resumen siguiente (closingDayToNext)', () => {
  const visaNext: CardCalendar = { card: { closingDay: 22, dueDay: 4, closingDayToNext: true }, overrides: [] }
  const visaSame: CardCalendar = { card: { closingDay: 22, dueDay: 4 }, overrides: [] }

  it('a purchase on the closing day goes to the next statement; the day before still enters', () => {
    expect(statementPeriodFor(visaNext, '2026-10-22')).toBe('2026-11')
    expect(statementPeriodFor(visaNext, '2026-10-21')).toBe('2026-10')
    // Without the option, the closing day enters, as before.
    expect(statementPeriodFor(visaSame, '2026-10-22')).toBe('2026-10')
  })

  it('the last purchase day of a statement is the day before its close — corrected dates too', () => {
    expect(lastPurchaseDay(visaNext, '2026-10')).toBe('2026-10-21')
    expect(lastPurchaseDay(visaSame, '2026-10')).toBe('2026-10-22')
    const corrected: CardCalendar = { ...visaNext, overrides: [{ period: '2026-11', closeDate: '2026-11-01', dueDate: '2026-11-10' }] }
    expect(lastPurchaseDay(corrected, '2026-11')).toBe('2026-10-31')
    expect(statementPeriodFor(corrected, '2026-11-01')).toBe('2026-12')
  })

  it('a cuota is capped at the last day its statement takes, never on the close itself', () => {
    // Bought Oct 22 (→ November): cuota 2 goes to December, dated Nov 22
    // while that's within December's statement…
    const capped: CardCalendar = { ...visaNext, overrides: [{ period: '2026-12', closeDate: '2026-12-20', dueDate: '2027-01-04' }] }
    expect(installmentPlacement(capped, '2026-10-22', 1)).toEqual({ period: '2026-12', date: '2026-11-22' })
    // …and when December's statement closes on Nov 22, capped at Nov 21:
    // the close itself would belong to the next statement.
    const late: CardCalendar = { ...visaNext, overrides: [{ period: '2026-12', closeDate: '2026-11-22', dueDate: '2026-12-04' }] }
    expect(installmentPlacement(late, '2026-10-22', 1)).toEqual({ period: '2026-12', date: '2026-11-21' })
  })
})
