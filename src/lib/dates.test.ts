import { describe, expect, it } from 'vitest'
import { dayOfMonth, daysBetween, isValidDateStamp, isValidMonthStamp } from './dates'

describe('isValidMonthStamp', () => {
  it('accepts a well-formed month', () => {
    expect(isValidMonthStamp('2026-08')).toBe(true)
    expect(isValidMonthStamp('1999-01')).toBe(true)
    expect(isValidMonthStamp('9999-12')).toBe(true)
  })

  it('rejects a value with the wrong shape', () => {
    expect(isValidMonthStamp('2026-8')).toBe(false)
    expect(isValidMonthStamp('2026-08-01')).toBe(false)
    expect(isValidMonthStamp('')).toBe(false)
    expect(isValidMonthStamp('garbage')).toBe(false)
    expect(isValidMonthStamp('abcd-ef')).toBe(false)
  })

  it('rejects an out-of-range month without throwing', () => {
    // These all match the shape regex but parse to an Invalid Date —
    // date-fns' format() throws RangeError on one, so the NaN guard in
    // isValidMonthStamp must run before the round-trip check does.
    for (const value of ['2026-13', '2026-00', '0000-01']) {
      expect(() => isValidMonthStamp(value)).not.toThrow()
      expect(isValidMonthStamp(value)).toBe(false)
    }
  })
})

describe('dayOfMonth', () => {
  it('returns that day of the month', () => {
    expect(dayOfMonth('2026-10', 25)).toBe('2026-10-25')
  })

  it('clamps past the month end (31 in February, 31 in a 30-day month)', () => {
    expect(dayOfMonth('2026-02', 31)).toBe('2026-02-28')
    expect(dayOfMonth('2028-02', 31)).toBe('2028-02-29')
    expect(dayOfMonth('2026-11', 31)).toBe('2026-11-30')
  })
})

describe('daysBetween', () => {
  it('counts calendar days, signed', () => {
    expect(daysBetween('2026-10-23', '2026-10-30')).toBe(7)
    expect(daysBetween('2026-10-30', '2026-10-23')).toBe(-7)
    expect(daysBetween('2026-10-23', '2026-10-23')).toBe(0)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })
})

describe('isValidDateStamp', () => {
  it('accepts a real day and rejects impossible ones without throwing', () => {
    expect(isValidDateStamp('2026-02-28')).toBe(true)
    expect(isValidDateStamp('2026-02-31')).toBe(false)
    expect(isValidDateStamp('2026-13-01')).toBe(false)
    expect(isValidDateStamp('26-02-01')).toBe(false)
  })
})
