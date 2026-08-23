import { invariant } from '@/lib/invariant'
import { minor, type Minor } from './money'

/**
 * Splits `total` minor units across `weights` proportionally, using the
 * largest-remainder method: every share is floored first, then the
 * leftover units go one-by-one to the shares with the largest fractional
 * remainder. This guarantees `sum(result) === total` exactly — critical
 * for installment schedules and expense splits, where naive rounding
 * would silently lose or invent a unit.
 *
 * `weights` don't need to sum to 1; e.g. `[1, 1, 1]` splits evenly and
 * `[2, 1]` splits 2:1. `total` must be >= 0.
 */
export function allocate(total: number, weights: readonly number[]): Minor[] {
  invariant(
    Number.isInteger(total) && total >= 0,
    `allocate: total must be a non-negative integer, got ${total}`,
  )
  invariant(weights.length > 0, 'allocate: weights must not be empty')
  invariant(
    weights.every((w) => w >= 0),
    'allocate: weights must be non-negative',
  )

  const weightSum = weights.reduce((a, b) => a + b, 0)
  invariant(weightSum > 0, 'allocate: sum of weights must be positive')

  const shares = weights.map((w, index) => {
    const raw = (total * w) / weightSum
    const floor = Math.floor(raw)
    return { index, floor, remainder: raw - floor }
  })

  let leftover = total - shares.reduce((sum, s) => sum + s.floor, 0)

  const bump = new Set<number>()
  for (const s of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (leftover <= 0) break
    bump.add(s.index)
    leftover -= 1
  }

  return shares
    .sort((a, b) => a.index - b.index)
    .map((s) => minor(s.floor + (bump.has(s.index) ? 1 : 0)))
}
