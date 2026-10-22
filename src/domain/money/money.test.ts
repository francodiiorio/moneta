import { describe, expect, it } from 'vitest'
import {
  add,
  applyRate,
  formatAxisAmount,
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

  // es-AR: el punto es separador de miles. Antes "900.000" se leía como
  // 900,00 (el último separador se tomaba siempre como decimal).
  describe('es-AR thousands with a dot', () => {
    it.each([
      ['900.000', 900_000_00],
      ['1.500', 1_500_00],
      ['15.000', 15_000_00],
      ['1.000.000', 1_000_000_00],
      ['-1.500', -1_500_00],
      ['$ 900.000', 900_000_00],
    ])('"%s" is a whole amount with thousands grouping', (input, expected) => {
      expect(parseAmount(input, 'ARS')).toEqual(money(expected, 'ARS'))
    })

    it.each([
      ['1.5', 1_50],
      ['10.25', 10_25],
      ['1234.567', 1_234_56], // 4-digit integer part: never a thousands group, so a decimal (truncated)
      ['0.500', 50], // leading zero: "0.500" is never "quinientos"
      ['.500', 50],
      ['1.000.50', 1_000_50], // malformed grouping: falls back to "last separator is the decimal"
    ])('"%s" keeps the dot as the decimal separator', (input, expected) => {
      expect(parseAmount(input, 'ARS')).toEqual(money(expected, 'ARS'))
    })

    it.each([
      ['1,5', 1_50],
      ['1,500', 1_50], // a single comma is always the decimal (es-AR), truncated past 2 decimals
      ['1,000,000', 1_000_000_00], // several commas only make sense as grouping
      ['1.050,50', 1_050_50],
      ['1,050.50', 1_050_50],
    ])('"%s" — commas and mixed separators', (input, expected) => {
      expect(parseAmount(input, 'ARS')).toEqual(money(expected, 'ARS'))
    })

    it('accepts a trailing minus (some bank exports write "1.500,00-") as negative', () => {
      expect(parseAmount('1.500,00-', 'ARS')).toEqual(money(-1_500_00, 'ARS'))
    })

    it.each(['--1.500', '1-500', '-1.500-', '1..000', '1,,5', '1.,5'])(
      'rejects malformed "%s" instead of guessing',
      (input) => {
        expect(() => parseAmount(input, 'ARS')).toThrow(/Monto inválido/)
      },
    )

    it('rejects an amount too large to be an exact integer', () => {
      expect(() => parseAmount('100.000.000.000.000', 'ARS')).toThrow(/demasiado grande/)
    })

    it('round-trips what formatMoney shows when editing (always two decimals)', () => {
      for (const amount of [0, 5, 1_500_00, 900_000_00, 1_234_567_89]) {
        const shown = formatMoney(money(amount, 'ARS')).replace(/[^\d,.-]/g, '')
        expect(parseAmount(shown, 'ARS')).toEqual(money(amount, 'ARS'))
      }
    })
  })

  // Regression: parseAmount is for user-typed text, not a raw JS number.
  // String(aVerySmallNumber) can produce scientific notation; this used to
  // be silently misread as 1,27 and now fails loud (the "-" in "1.2e-7"
  // is in the middle). moneyFromNumber below is still the right tool for
  // any caller (e.g. an API response) that has a real number, not text.
  it('rejects scientific notation instead of misreading it — use moneyFromNumber for a raw number', () => {
    expect(() => parseAmount(String(1.2e-7), 'USD')).toThrow(/Monto inválido/)
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

describe('formatAxisAmount', () => {
  it('formats ARS with grouped thousands, no symbol and no decimals', () => {
    expect(formatAxisAmount(105000, 'ARS')).toBe('1.050')
  })

  it('formats USD with its own locale grouping, no symbol and no decimals', () => {
    expect(formatAxisAmount(747100, 'USD')).toBe('7,471')
  })

  it('rounds a non-integer input instead of throwing — a chart library-interpolated tick is not a real Minor amount', () => {
    expect(formatAxisAmount(105050.7, 'ARS')).toBe('1.051')
  })

  it('handles zero', () => {
    expect(formatAxisAmount(0, 'ARS')).toBe('0')
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
