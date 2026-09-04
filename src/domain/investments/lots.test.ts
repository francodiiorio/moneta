import { describe, expect, it } from 'vitest'
import { quantity, QUANTITY_SCALE } from '@/domain/decimal'
import { money } from '@/domain/money'
import { aggregateLots } from './lots'

describe('aggregateLots', () => {
  it('is empty for no lots', () => {
    expect(aggregateLots([])).toEqual({ quantity: quantity(0) })
  })

  it('matches a single costed lot exactly', () => {
    const result = aggregateLots([{ quantity: quantity(5 * QUANTITY_SCALE), costPerUnit: money(10_000, 'USD') }])
    expect(result).toEqual({ quantity: quantity(5 * QUANTITY_SCALE), averageCost: 10_000 })
  })

  it('computes the weighted average across lots of different sizes', () => {
    // 5 units @ $100,00 + 3 units @ $120,00 -> (500+360)/8 = $107,50
    const result = aggregateLots([
      { quantity: quantity(5 * QUANTITY_SCALE), costPerUnit: money(10_000, 'USD') },
      { quantity: quantity(3 * QUANTITY_SCALE), costPerUnit: money(12_000, 'USD') },
    ])
    expect(result).toEqual({ quantity: quantity(8 * QUANTITY_SCALE), averageCost: 10_750 })
  })

  it('rounds a tied average half-up', () => {
    // 1 unit @ $1,00 + 1 unit @ $1,01 -> (100+101)/2 = 100,5 -> rounds to 101
    const result = aggregateLots([
      { quantity: quantity(1 * QUANTITY_SCALE), costPerUnit: money(100, 'USD') },
      { quantity: quantity(1 * QUANTITY_SCALE), costPerUnit: money(101, 'USD') },
    ])
    expect(result.averageCost).toBe(101)
  })

  it('treats an explicit zero cost as costed, not missing', () => {
    const result = aggregateLots([{ quantity: quantity(1 * QUANTITY_SCALE), costPerUnit: money(0, 'USD') }])
    expect(result.averageCost).toBe(0)
  })

  // Regression: averaging only the costed lots and applying that average
  // to the full quantity would invent precision that isn't there — one
  // uncosted lot has to blank the whole aggregate's cost, same "don't
  // guess" rule CLAUDE.md applies to a missing exchange rate.
  it('has no average cost at all when even one lot lacks a cost', () => {
    const result = aggregateLots([
      { quantity: quantity(5 * QUANTITY_SCALE), costPerUnit: money(10_000, 'USD') },
      { quantity: quantity(3 * QUANTITY_SCALE) },
    ])
    expect(result).toEqual({ quantity: quantity(8 * QUANTITY_SCALE) })
    expect(result.averageCost).toBeUndefined()
  })

  it('rejects a total quantity that overflows the safe integer range', () => {
    expect(() =>
      aggregateLots([{ quantity: quantity(Number.MAX_SAFE_INTEGER) }, { quantity: quantity(1) }]),
    ).toThrow(/overflow/)
  })

  it('rejects a total cost that overflows the safe integer range', () => {
    // Each lot's own valuePosition stays safe (1 unit × 60.000.000 = 6e15,
    // under Number.MAX_SAFE_INTEGER), but the sum (1,2e8) × QUANTITY_SCALE
    // (1e8) is 1,2e16 — past it. Isolates aggregateLots's own guard from
    // valuePosition's (already tested in domain/decimal/quantity.test.ts).
    const lot = { quantity: quantity(1 * QUANTITY_SCALE), costPerUnit: money(60_000_000, 'USD') }
    expect(() => aggregateLots([lot, lot])).toThrow(/overflow/)
  })
})
