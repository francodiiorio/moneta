import { describe, expect, it } from 'vitest'
import {
  add,
  applyRate,
  formatMoney,
  isNegative,
  isPositive,
  isZero,
  minor,
  money,
  moneyFromNumber,
  negate,
  parseAmount,
  percentChange,
  roundHalfUp,
  sub,
  sumMoney,
  zero,
} from './money'

describe('minor', () => {
  it('accepts integers', () => {
    expect(minor(1050)).toBe(1050)
  })

  it('rejects non-integers to prevent float amounts', () => {
    expect(() => minor(10.5)).toThrow(/integer/)
  })
})

describe('arithmetic', () => {
  it('adds and subtracts money in the same currency', () => {
    const a = money(1000, 'ARS')
    const b = money(250, 'ARS')
    expect(add(a, b)).toEqual(money(1250, 'ARS'))
    expect(sub(a, b)).toEqual(money(750, 'ARS'))
  })

  it('throws when mixing currencies', () => {
    expect(() => add(money(100, 'ARS'), money(100, 'USD'))).toThrow(/currenc/i)
  })

  it('negates', () => {
    expect(negate(money(500, 'ARS'))).toEqual(money(-500, 'ARS'))
  })

  it('reports sign', () => {
    expect(isZero(zero('ARS'))).toBe(true)
    expect(isPositive(money(1, 'ARS'))).toBe(true)
    expect(isNegative(money(-1, 'ARS'))).toBe(true)
  })

  it('sums a list, defaulting to zero for an empty list', () => {
    expect(sumMoney('ARS', [])).toEqual(zero('ARS'))
    expect(sumMoney('ARS', [money(100, 'ARS'), money(200, 'ARS'), money(-50, 'ARS')])).toEqual(
      money(250, 'ARS'),
    )
  })
})

describe('roundHalfUp', () => {
  it('rounds ties away from zero symmetrically', () => {
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(-2.5)).toBe(-3)
    expect(roundHalfUp(2.4)).toBe(2)
    expect(roundHalfUp(-2.4)).toBe(-2)
  })
})

describe('applyRate', () => {
  it('applies a rate and rounds half-up', () => {
    // 4 * 1.125 = 4.5 exactly (both operands are exact binary fractions) -> 5
    expect(applyRate(minor(4), 1.125)).toBe(5)
  })

  it('rejects non-positive rates', () => {
    expect(() => applyRate(minor(100), 0)).toThrow(/positive/)
    expect(() => applyRate(minor(100), -1)).toThrow(/positive/)
  })
})

describe('parseAmount', () => {
  it('parses a plain integer string', () => {
    expect(parseAmount('1050', 'ARS')).toEqual(money(105000, 'ARS'))
  })

  it('parses a comma-decimal amount (es-AR style)', () => {
    expect(parseAmount('1.050,50', 'ARS')).toEqual(money(105050, 'ARS'))
  })

  it('parses a dot-decimal amount (en-US style)', () => {
    expect(parseAmount('1,050.50', 'USD')).toEqual(money(105050, 'USD'))
  })

  it('parses negative amounts', () => {
    expect(parseAmount('-10,50', 'ARS')).toEqual(money(-1050, 'ARS'))
  })

  it('pads a short fraction', () => {
    expect(parseAmount('10,5', 'ARS')).toEqual(money(1050, 'ARS'))
  })

  // Regression: parseAmount is for user-typed text, not a raw JS number.
  // String(aVerySmallNumber) can produce scientific notation, which
  // parseAmount's decimal-separator heuristic silently misreads instead
  // of failing — this is exactly why moneyFromNumber exists below, for
  // any caller (e.g. an API response) that has a real number, not text.
  it('documents the scientific-notation trap: do not feed a raw number through String() into this', () => {
    expect(parseAmount(String(1.2e-7), 'USD')).toEqual(money(127, 'USD')) // wrong on purpose, see moneyFromNumber
  })
})

describe('moneyFromNumber', () => {
  it('converts a plain float to Minor, rounding half-up', () => {
    expect(moneyFromNumber(1050.5, 'ARS')).toEqual(money(105050, 'ARS'))
  })

  it('rounds a tiny value that has no representable minor unit down to zero, never a wrong huge amount', () => {
    // The exact scenario parseAmount(String(...)) gets wrong above.
    expect(moneyFromNumber(1.2e-7, 'USD')).toEqual(money(0, 'USD'))
  })

  it('handles negative numbers', () => {
    expect(moneyFromNumber(-10.5, 'ARS')).toEqual(money(-1050, 'ARS'))
  })

  it('matches parseAmount for a normal, non-scientific-notation value', () => {
    expect(moneyFromNumber(77408.12, 'USD')).toEqual(parseAmount('77408.12', 'USD'))
  })
})

describe('formatMoney', () => {
  it('formats ARS with 2 decimals and the $ symbol', () => {
    const formatted = formatMoney(money(105050, 'ARS'))
    expect(formatted).toContain('1.050,50')
    expect(formatted).toContain('$')
  })

  it('formats USD with the "USD" code instead of "$" — indistinguishable from ARS otherwise', () => {
    const formatted = formatMoney(money(747117, 'USD'))
    // Intl separates the code from the amount with a non-breaking space.
    expect(formatted.replace(/\s/g, ' ')).toBe('USD 7,471.17')
    expect(formatted).not.toContain('$')
  })

  it('falls back to symbol formatting for a malformed currency code', () => {
    // 'AR' isn't a well-formed 3-letter ISO 4217 code, so Intl throws.
    const formatted = formatMoney(money(1050, 'AR'))
    expect(formatted).toBe('AR 10.50')
  })
})

describe('percentChange', () => {
  it('computes a positive change', () => {
    expect(percentChange(money(1000, 'ARS'), money(1200, 'ARS'))).toBe(20)
  })

  it('computes a negative change', () => {
    expect(percentChange(money(1000, 'ARS'), money(800, 'ARS'))).toBe(-20)
  })

  it('returns 0 for no change', () => {
    expect(percentChange(money(1000, 'ARS'), money(1000, 'ARS'))).toBe(0)
  })

  it('returns undefined when previous is zero, instead of dividing by zero', () => {
    expect(percentChange(money(0, 'ARS'), money(500, 'ARS'))).toBeUndefined()
    expect(percentChange(money(0, 'ARS'), money(0, 'ARS'))).toBeUndefined()
  })

  it('rejects comparing across currencies', () => {
    expect(() => percentChange(money(1000, 'ARS'), money(10, 'USD'))).toThrow(/currencies/)
  })

  it('rejects a negative amount, e.g. a signed net balance instead of a non-negative total', () => {
    expect(() => percentChange(money(-1000, 'ARS'), money(-500, 'ARS'))).toThrow(/non-negative/)
    expect(() => percentChange(money(1000, 'ARS'), money(-500, 'ARS'))).toThrow(/non-negative/)
  })
})
