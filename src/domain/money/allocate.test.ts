import { describe, expect, it } from 'vitest'
import { allocate } from './allocate'

describe('allocate', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(allocate(300, [1, 1, 1])).toEqual([100, 100, 100])
  })

  it('gives the remainder to the largest fractional shares (largest-remainder method)', () => {
    // 100 / 3 = 33.33 each -> floors [33,33,33] leave 1 unit over
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
  })

  it('respects weighted proportions, e.g. 2:1', () => {
    expect(allocate(90, [2, 1])).toEqual([60, 30])
  })

  it('puts everything on the single weight', () => {
    expect(allocate(1234, [1])).toEqual([1234])
  })

  it('handles a zero total', () => {
    expect(allocate(0, [1, 1, 1])).toEqual([0, 0, 0])
  })

  it('rejects a negative total', () => {
    expect(() => allocate(-100, [1, 1])).toThrow(/non-negative/)
  })

  it('rejects empty weights', () => {
    expect(() => allocate(100, [])).toThrow(/empty/)
  })

  it('rejects all-zero weights', () => {
    expect(() => allocate(100, [0, 0])).toThrow(/positive/)
  })

  it('always sums back to the total, across many totals and split counts', () => {
    for (let total = 0; total <= 500; total += 7) {
      for (let count = 1; count <= 12; count++) {
        const weights = Array.from({ length: count }, (_, i) => i + 1) // 1..count
        const parts = allocate(total, weights)
        const sum = parts.reduce((a, b) => a + b, 0)
        expect(sum).toBe(total)
        expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true)
      }
    }
  })
})
