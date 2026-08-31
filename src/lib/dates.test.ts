import { describe, expect, it } from 'vitest'
import { isValidMonthStamp } from './dates'

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
