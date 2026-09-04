import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import { divideHalfUp, formatQuantity, parseQuantity, quantity, valuePosition, QUANTITY_SCALE } from './quantity'

describe('quantity / parseQuantity', () => {
  it('rejects a non-integer scaled value', () => {
    expect(() => quantity(1.5)).toThrow(/integer/)
  })

  it('rejects a negative scaled value', () => {
    expect(() => quantity(-1)).toThrow(/negative/)
  })

  it('parses a whole number', () => {
    expect(parseQuantity('5')).toBe(5 * QUANTITY_SCALE)
  })

  it('parses a small fractional amount (crypto-sized)', () => {
    expect(parseQuantity('0.00123456')).toBe(123456)
  })

  it('parses using either "," or "." as the decimal separator', () => {
    expect(parseQuantity('1,5')).toBe(1.5 * QUANTITY_SCALE)
    expect(parseQuantity('1.5')).toBe(1.5 * QUANTITY_SCALE)
  })

  it('truncates (does not round) past 8 decimal places', () => {
    expect(parseQuantity('0.123456789')).toBe(12345678)
  })

  it('rejects a negative input string', () => {
    expect(() => parseQuantity('-1')).toThrow(/negative/)
  })

  it('rejects an empty or garbage input', () => {
    expect(() => parseQuantity('')).toThrow()
    expect(() => parseQuantity('abc')).toThrow()
  })
})

describe('formatQuantity', () => {
  it('round-trips a whole number without trailing zeros', () => {
    expect(formatQuantity(parseQuantity('5'))).toBe('5')
  })

  it('round-trips a fractional amount', () => {
    expect(formatQuantity(parseQuantity('0.00123456'))).toBe('0,00123456')
  })

  // Regression: formatQuantity used to apply thousands grouping
  // ("1.000"), and an integer with no real decimal separator round-tripped
  // through parseQuantity misread the grouping dot as the decimal point,
  // silently dividing the value by 1000 — a real bug caught before this
  // shipped (see the "silently corrupts" comment on formatQuantity).
  it('round-trips an integer with 4+ digits without a thousands separator confusing parseQuantity', () => {
    for (const value of ['1000', '1500', '10000', '100000', '1000000']) {
      expect(formatQuantity(parseQuantity(value))).toBe(value)
      expect(parseQuantity(formatQuantity(parseQuantity(value)))).toBe(parseQuantity(value))
    }
  })
})

describe('valuePosition', () => {
  it('values a whole-share position at its unit price', () => {
    const price = money(65_000_00, 'USD') // USD 65.000,00 (2 decimals, minor units)
    expect(valuePosition(parseQuantity('5'), price)).toEqual(money(5 * 65_000_00, 'USD'))
  })

  it('values a fractional position, rounding half-up', () => {
    const price = money(300, 'USD') // USD 3,00
    // 0.5 units * 3,00 = 1,50 -> exact, no rounding needed
    expect(valuePosition(parseQuantity('0.5'), price)).toEqual(money(150, 'USD'))
  })

  it('rounds half-up symmetrically on a tie', () => {
    const price = money(1, 'USD') // USD 0,01 — smallest possible unit
    // 0.5 units (scaled) * 1 minor = exactly 0.5 minor -> ties round up to 1
    expect(valuePosition(quantity(QUANTITY_SCALE / 2), price)).toEqual(money(1, 'USD'))
  })

  it('is zero for a zero quantity', () => {
    const price = money(65_000_00, 'USD')
    expect(valuePosition(quantity(0), price)).toEqual(money(0, 'USD'))
  })

  it('rejects a position value that overflows the safe integer range', () => {
    const price = money(Number.MAX_SAFE_INTEGER, 'USD')
    expect(() => valuePosition(parseQuantity('2'), price)).toThrow(/overflow/)
  })

  // Regression: 380 CEDEAR units at ARS 20.370,00/unit — a perfectly
  // ordinary position (final value ARS 7.740.600,00) that used to crash
  // the whole app with "Position value overflows safe integer range".
  // `q * price.amount` (quantity(380) = 38_000_000_000, price.amount =
  // 2_037_000) overflows Number.MAX_SAFE_INTEGER as an *intermediate*
  // product — ARS CEDEAR prices are routinely in the tens of thousands,
  // unlike the USD prices this function was originally exercised with —
  // even though the real, final position value never does. Confirmed
  // this fails with the pre-fix float multiplication before the BigInt
  // rewrite (`InvariantError: Position value overflows safe integer
  // range (quantity=38000000000, price=2037000)`).
  it('values a large peso-denominated position whose intermediate product would overflow as a float, but whose final value does not', () => {
    const price = money(2_037_000, 'ARS') // ARS 20.370,00 — a realistic CEDEAR price
    expect(valuePosition(quantity(38_000_000_000), price)).toEqual(money(774_060_000, 'ARS'))
  })
})

describe('divideHalfUp', () => {
  it('rounds ties up for a non-negative numerator, same as roundHalfUp', () => {
    expect(divideHalfUp(5n, 10n)).toBe(1n) // 0,5 -> 1
    expect(divideHalfUp(15n, 10n)).toBe(2n) // 1,5 -> 2
    expect(divideHalfUp(4n, 10n)).toBe(0n) // 0,4 -> 0
  })

  // Regression found in review: BigInt division truncates toward zero,
  // not toward -Infinity, so a negative numerator would round *toward*
  // zero instead of away from it — quietly breaking the symmetric
  // half-up contract this function claims to match (roundHalfUp(-0.5)
  // is -1, not 0). Both current callers only ever pass a non-negative
  // numerator (Quantity can't be negative; a genuinely negative
  // costPerUnit would have to come from a corrupted or hand-edited
  // backup, since nothing at the domain-schema level rejects one), so
  // this is a loud rejection rather than a silent wrong average.
  it('rejects a negative numerator instead of silently rounding toward zero', () => {
    expect(() => divideHalfUp(-5n, 10n)).toThrow(/non-negative/)
  })

  it('rejects a non-positive denominator', () => {
    expect(() => divideHalfUp(5n, 0n)).toThrow(/positive/)
    expect(() => divideHalfUp(5n, -10n)).toThrow(/positive/)
  })
})
