import { describe, expect, it } from 'vitest'
import { duplicateKey, mentionedOwnName, takeCandidate, type DuplicateCandidate } from './matching'

describe('duplicateKey', () => {
  it('includes the currency: USD 50 never matches ARS 50', () => {
    expect(duplicateKey('2026-08-23', 5000, 'USD', 'Netflix')).not.toBe(duplicateKey('2026-08-23', 5000, 'ARS', 'Netflix'))
  })

  it('ignores case and surrounding spaces; ingresos only match ingresos', () => {
    expect(duplicateKey('2026-08-23', 1, 'ARS', '  SUPER ')).toBe(duplicateKey('2026-08-23', 1, 'ARS', 'super'))
    expect(duplicateKey('2026-08-23', 1, 'ARS', 'x', 'income')).not.toBe(duplicateKey('2026-08-23', 1, 'ARS', 'x'))
  })
})

describe('takeCandidate', () => {
  const payment: DuplicateCandidate = { direction: 'out', amount: 80_000_00, currency: 'ARS', date: '2026-10-05', label: 'Pago de resumen' }
  const row = { direction: 'out' as const, amount: 80_000_00, currency: 'ARS', date: '2026-10-07' }

  it('matches by amount and currency within the date window, regardless of description', () => {
    expect(takeCandidate([payment], new Set(), row)).toBe(0)
    expect(takeCandidate([payment], new Set(), { ...row, date: '2026-10-09' })).toBeUndefined()
    expect(takeCandidate([payment], new Set(), { ...row, currency: 'USD' })).toBeUndefined()
    expect(takeCandidate([payment], new Set(), { ...row, direction: 'in' })).toBeUndefined()
  })

  it('a card gasto in the same statement matches whatever its date (an installment)', () => {
    const cuota: DuplicateCandidate = { ...payment, date: '2026-12-10', period: '2026-12', label: 'Gasto' }
    expect(takeCandidate([cuota], new Set(), { ...row, date: '2026-09-10', period: '2026-12' })).toBe(0)
    expect(takeCandidate([cuota], new Set(), { ...row, date: '2026-09-10', period: '2026-11' })).toBeUndefined()
  })

  it('each candidate covers one row only', () => {
    const taken = new Set<number>()
    expect(takeCandidate([payment], taken, row)).toBe(0)
    expect(takeCandidate([payment], taken, row)).toBeUndefined()
  })
})

describe('mentionedOwnName', () => {
  it('finds another account or card named in the description, case-insensitively', () => {
    expect(mentionedOwnName('PAGO VISA GALICIA', ['Brubank', 'Visa'])).toBe('Visa')
    expect(mentionedOwnName('COTO SUC 123', ['Brubank', 'Visa'])).toBeUndefined()
    expect(mentionedOwnName('PAGO MP', ['MP'])).toBeUndefined()
  })
})
