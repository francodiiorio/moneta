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

  // Regression: this used to throw here even though the real average cost
  // (60.000.000, exactly what each identical lot already costs) is a
  // perfectly ordinary number — the old computation multiplied the total
  // cost by QUANTITY_SCALE (1e8) as a plain float *before* dividing by
  // the total quantity, an intermediate product that overflows
  // Number.MAX_SAFE_INTEGER long before the division brings it back down
  // to something safe. Same class of bug as valuePosition's own fix (see
  // domain/decimal/quantity.ts) — confirmed this throws with the pre-fix
  // float multiplication before the BigInt rewrite.
  it('averages two identical lots without overflowing, even though the intermediate scaled cost would as a float', () => {
    const lot = { quantity: quantity(1 * QUANTITY_SCALE), costPerUnit: money(60_000_000, 'USD') }
    const result = aggregateLots([lot, lot])
    expect(result).toEqual({ quantity: quantity(2 * QUANTITY_SCALE), averageCost: 60_000_000 })
  })

  // A genuine overflow, isolated from valuePosition's own guard: each
  // lot's valuePosition stays safe (1 raw unit × 1e16 / QUANTITY_SCALE =
  // 1e8), but re-scaling that already-safe total cost by QUANTITY_SCALE
  // again (to recover a per-unit average against a tiny total quantity)
  // pushes the *final* averageCost itself past Number.MAX_SAFE_INTEGER —
  // a case aggregateLots's own guard has to catch, not valuePosition's.
  it('rejects an average cost that genuinely overflows the safe integer range', () => {
    const lot = { quantity: quantity(1), costPerUnit: money(1e16, 'USD') }
    expect(() => aggregateLots([lot])).toThrow(/overflow/)
  })
})
