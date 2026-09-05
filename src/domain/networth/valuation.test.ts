import { describe, expect, it } from 'vitest'
import { parseQuantity } from '@/domain/decimal'
import type { ExchangeRate, SavingsHolding } from '@/domain/entities'
import { money } from '@/domain/money'
import { valuateNetWorth, type ValuationInput } from './valuation'

const now = new Date().toISOString()

function saving(overrides: Partial<SavingsHolding> = {}): SavingsHolding {
  return {
    id: 's1',
    name: 'Ahorro',
    currency: 'ARS',
    amount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function baseInput(overrides: Partial<ValuationInput> = {}): ValuationInput {
  return {
    savings: [],
    positions: [],
    rates: [],
    displayCurrency: 'ARS',
    date: '2026-08-23',
    ...overrides,
  }
}

describe('valuateNetWorth — currency conversion basics', () => {
  it('same currency: no rate needed, amount passes through unchanged', () => {
    const result = valuateNetWorth(
      baseInput({ savings: [saving({ currency: 'ARS', amount: 100_000 })], displayCurrency: 'ARS' }),
    )
    expect(result.total).toEqual(money(100_000, 'ARS'))
    expect(result.missingRateCount).toBe(0)
  })

  it('USD -> ARS using a loaded rate', () => {
    const rates: ExchangeRate[] = [{ id: 'r1', date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 }]
    const result = valuateNetWorth(
      baseInput({ savings: [saving({ currency: 'USD', amount: 100_00 })], rates, displayCurrency: 'ARS' }),
    )
    expect(result.total).toEqual(money(100_00 * 1450, 'ARS'))
  })

  it('ARS -> USD using the reciprocal of a loaded rate', () => {
    const rates: ExchangeRate[] = [{ id: 'r1', date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 }]
    const result = valuateNetWorth(
      baseInput({ savings: [saving({ currency: 'ARS', amount: 1_450_00 })], rates, displayCurrency: 'USD' }),
    )
    expect(result.total).toEqual(money(100, 'USD'))
  })
})

describe('valuateNetWorth — mixed net worth', () => {
  const rates: ExchangeRate[] = [{ id: 'r1', date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 }]

  it('ARS 3.000.000 + USD 8.000 valued in ARS', () => {
    const result = valuateNetWorth(
      baseInput({
        savings: [
          saving({ id: 's1', currency: 'ARS', amount: 3_000_000_00 }),
          saving({ id: 's2', currency: 'USD', amount: 8_000_00 }),
        ],
        rates,
        displayCurrency: 'ARS',
      }),
    )
    // 3.000.000 + 8.000 * 1450 = 3.000.000 + 11.600.000 = 14.600.000
    expect(result.total).toEqual(money(14_600_000_00, 'ARS'))
    expect(result.byBucket.savings).toEqual(money(14_600_000_00, 'ARS'))
  })

  it('the same net worth valued in USD instead', () => {
    const result = valuateNetWorth(
      baseInput({
        savings: [
          saving({ id: 's1', currency: 'ARS', amount: 3_000_000_00 }),
          saving({ id: 's2', currency: 'USD', amount: 8_000_00 }),
        ],
        rates,
        displayCurrency: 'USD',
      }),
    )
    // 3.000.000 ARS / 1450 ≈ 2068.97 USD + 8.000 USD ≈ 10.068,97 USD
    expect(result.total.currency).toBe('USD')
    expect(result.total.amount / 100).toBeCloseTo(3_000_000 / 1450 + 8_000, 1)
  })
})

describe('valuateNetWorth — investments (quantity × price, then convert)', () => {
  it('values 5 SPY at USD 650 as USD 3.250, and converts that (not a SPY -> ARS shortcut)', () => {
    const rates: ExchangeRate[] = [{ id: 'r1', date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 }]
    const result = valuateNetWorth(
      baseInput({
        positions: [{ quantity: parseQuantity('5'), price: money(650_00, 'USD') }],
        rates,
        displayCurrency: 'ARS',
      }),
    )
    expect(result.byBucket.investments).toEqual(money(5 * 650_00 * 1450, 'ARS'))
    expect(result.missingPriceCount).toBe(0)
  })
})

describe('valuateNetWorth — edge cases', () => {
  it('excludes an item with a missing rate from the total, and counts it', () => {
    const result = valuateNetWorth(
      baseInput({
        savings: [
          saving({ id: 's1', currency: 'ARS', amount: 100_000 }),
          saving({ id: 's2', currency: 'EUR', amount: 100_00 }), // no EUR rate loaded
        ],
        displayCurrency: 'ARS',
      }),
    )
    expect(result.total).toEqual(money(100_000, 'ARS')) // EUR saving excluded, not zeroed
    expect(result.missingRateCount).toBe(1)
  })

  it('a rate dated after the valuation date does not count as available (stale/vencida)', () => {
    const rates: ExchangeRate[] = [{ id: 'r1', date: '2026-09-01', from: 'USD', to: 'ARS', rate: 1450 }]
    const result = valuateNetWorth(
      baseInput({
        savings: [saving({ currency: 'USD', amount: 100_00 })],
        rates,
        date: '2026-08-01',
        displayCurrency: 'ARS',
      }),
    )
    expect(result.missingRateCount).toBe(1)
    expect(result.total).toEqual(money(0, 'ARS'))
  })

  it('a position with no price is excluded and counted separately from missing rates', () => {
    const result = valuateNetWorth(
      baseInput({
        positions: [{ quantity: parseQuantity('10') }],
        displayCurrency: 'ARS',
      }),
    )
    expect(result.missingPriceCount).toBe(1)
    expect(result.missingRateCount).toBe(0)
    expect(result.byBucket.investments).toEqual(money(0, 'ARS'))
  })

  it('a zero amount contributes zero without being treated as missing', () => {
    const result = valuateNetWorth(baseInput({ savings: [saving({ currency: 'ARS', amount: 0 })] }))
    expect(result.total).toEqual(money(0, 'ARS'))
    expect(result.missingRateCount).toBe(0)
  })

  it('an entirely empty net worth values as zero with no misses', () => {
    const result = valuateNetWorth(baseInput())
    expect(result.total).toEqual(money(0, 'ARS'))
    expect(result.missingRateCount).toBe(0)
    expect(result.missingPriceCount).toBe(0)
  })

  it('a negative amount (e.g. a hand-entered debt) is valued as-is, not excluded', () => {
    const result = valuateNetWorth(baseInput({ savings: [saving({ currency: 'ARS', amount: -50_000 })] }))
    expect(result.total).toEqual(money(-50_000, 'ARS'))
  })
})
