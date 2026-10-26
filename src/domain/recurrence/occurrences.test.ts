import { describe, expect, it } from 'vitest'
import type { RecurrenceRule } from '@/domain/entities'
import { describeRule, generateOccurrences, nextOccurrenceAfter, firstPendingOccurrence, pendingOccurrencesInRange } from './occurrences'

function rule(overrides: Partial<RecurrenceRule> & Pick<RecurrenceRule, 'freq' | 'startDate'>): RecurrenceRule {
  return { interval: 1, ...overrides }
}

describe('generateOccurrences', () => {
  it('anchors dayOfMonth: 31 to the anchor date, not the previous occurrence (no drift after February)', () => {
    const dates = generateOccurrences(
      rule({ freq: 'monthly', dayOfMonth: 31, startDate: '2026-01-31' }),
      '2026-04-30',
    )
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('steps by interval', () => {
    const dates = generateOccurrences(rule({ freq: 'daily', interval: 3, startDate: '2026-01-01' }), '2026-01-10')
    expect(dates).toEqual(['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10'])
  })

  it('stops at endDate', () => {
    const dates = generateOccurrences(
      rule({ freq: 'monthly', startDate: '2026-01-01', endDate: '2026-03-15' }),
      '2026-12-31',
    )
    expect(dates).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })

  it('stops at maxOccurrences', () => {
    const dates = generateOccurrences(
      rule({ freq: 'monthly', startDate: '2026-01-01', maxOccurrences: 2 }),
      '2026-12-31',
    )
    expect(dates).toEqual(['2026-01-01', '2026-02-01'])
  })

  it('snaps weekly occurrences to the given weekday', () => {
    // 2026-01-01 is a Thursday (4); weekday 1 = Monday
    const dates = generateOccurrences(
      rule({ freq: 'weekly', weekday: 1, startDate: '2026-01-01' }),
      '2026-01-20',
    )
    expect(dates).toEqual(['2026-01-05', '2026-01-12', '2026-01-19'])
  })

  it('returns an empty array when the rule has not started yet', () => {
    const dates = generateOccurrences(rule({ freq: 'monthly', startDate: '2027-01-01' }), '2026-12-31')
    expect(dates).toEqual([])
  })

  it('includes through as an occurrence date when it lands exactly on one', () => {
    const dates = generateOccurrences(rule({ freq: 'monthly', startDate: '2026-01-01' }), '2026-02-01')
    expect(dates).toEqual(['2026-01-01', '2026-02-01'])
  })
})

describe('nextOccurrenceAfter', () => {
  it('finds the first occurrence strictly after the given date', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-01-01' })
    expect(nextOccurrenceAfter(r, '2026-03-15')).toBe('2026-04-01')
  })

  it('returns undefined once endDate is exhausted', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-01-01', endDate: '2026-02-01' })
    expect(nextOccurrenceAfter(r, '2026-02-01')).toBeUndefined()
  })

  it('returns undefined once maxOccurrences is exhausted', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-01-01', maxOccurrences: 2 })
    expect(nextOccurrenceAfter(r, '2026-02-01')).toBeUndefined()
  })
})

describe('describeRule', () => {
  it('describes a simple monthly rule', () => {
    expect(describeRule(rule({ freq: 'monthly', startDate: '2026-01-01' }))).toBe('Todos los meses')
  })

  it('describes a monthly rule with dayOfMonth', () => {
    expect(describeRule(rule({ freq: 'monthly', dayOfMonth: 5, startDate: '2026-01-01' }))).toBe(
      'Todos los meses el día 5',
    )
  })

  it('describes a rule with interval > 1', () => {
    expect(describeRule(rule({ freq: 'weekly', interval: 2, startDate: '2026-01-01' }))).toBe('Cada 2 semanas')
  })
})

describe('firstPendingOccurrence', () => {
  const rule = { freq: 'monthly' as const, interval: 1, dayOfMonth: 5, startDate: '2025-01-05' }

  it('is the very first occurrence when nothing was generated yet', () => {
    expect(firstPendingOccurrence(rule, undefined)).toBe('2025-01-05')
  })

  it('is the next one after the last generated date', () => {
    expect(firstPendingOccurrence(rule, '2026-06-05')).toBe('2026-07-05')
  })

  it('is undefined once the rule is exhausted', () => {
    expect(firstPendingOccurrence({ ...rule, maxOccurrences: 2 }, '2025-02-05')).toBeUndefined()
  })
})

describe('pendingOccurrencesInRange', () => {
  const monthly = { freq: 'monthly' as const, interval: 1, dayOfMonth: 1, startDate: '2026-10-01' }

  it('the next month’s occurrence, not generated yet, is pending', () => {
    expect(pendingOccurrencesInRange(monthly, '2026-10-01', '2026-11-01', '2026-11-30')).toEqual(['2026-11-01'])
  })

  it('an occurrence already generated is not pending', () => {
    expect(pendingOccurrencesInRange(monthly, '2026-11-01', '2026-11-01', '2026-11-30')).toEqual([])
  })

  it('only the range: neither earlier nor later occurrences', () => {
    expect(pendingOccurrencesInRange(monthly, undefined, '2026-11-01', '2026-12-31')).toEqual(['2026-11-01', '2026-12-01'])
  })

  it('respects the rule’s end', () => {
    expect(pendingOccurrencesInRange({ ...monthly, endDate: '2026-11-15' }, '2026-10-01', '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-01',
    ])
  })

  it('weekly: every one in the month', () => {
    const weekly = { freq: 'weekly' as const, interval: 1, startDate: '2026-11-02' }
    expect(pendingOccurrencesInRange(weekly, '2026-11-09', '2026-11-01', '2026-11-30')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30'])
  })
})
