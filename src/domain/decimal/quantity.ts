import type { Money } from '@/domain/money'
import { money } from '@/domain/money'
import { invariant } from '@/lib/invariant'

/** Fixed-point scale for a `Quantity` — 8 decimal places, enough for a
 *  satoshi. Same idea as `Minor` for money, but for units of an asset
 *  (shares, coins) rather than currency, which never has a single fixed
 *  number of decimals across every instrument. */
export const QUANTITY_SCALE = 100_000_000

/** An amount of units of an investment asset, stored as an integer
 *  scaled by `QUANTITY_SCALE` — never a float. See CLAUDE.md "Reglas
 *  financieras": the same reasoning that forbids float money applies to
 *  a fractional share/coin count feeding into a monetary calculation. */
export type Quantity = number & { readonly __quantityScale: unique symbol }

export function quantity(scaled: number): Quantity {
  invariant(Number.isInteger(scaled), `Quantity must be an integer (scaled), got ${scaled}`)
  invariant(scaled >= 0, `Quantity cannot be negative, got ${scaled}`)
  return scaled as Quantity
}

/** Parses a locale-loose decimal string (same separator rules as
 *  `parseAmount`) into a `Quantity`. Digits past 8 decimal places are
 *  truncated, not rounded. */
export function parseQuantity(input: string): Quantity {
  const cleaned = input.trim().replace(/[^\d.,-]/g, '')
  invariant(cleaned.length > 0, `Cannot parse quantity from "${input}"`)
  invariant(!cleaned.startsWith('-'), `Quantity cannot be negative, got "${input}"`)

  const decimalIndex = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'))
  const integerPart = decimalIndex === -1 ? cleaned : cleaned.slice(0, decimalIndex).replace(/[.,]/g, '')
  const fractionPart = decimalIndex === -1 ? '' : cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, '')

  const paddedFraction = (fractionPart + '0'.repeat(8)).slice(0, 8)
  const digits = (integerPart.replace(/[.,]/g, '') || '0') + paddedFraction
  const scaled = Number.parseInt(digits, 10)
  invariant(Number.isFinite(scaled), `Cannot parse quantity from "${input}"`)

  return quantity(scaled)
}

/** Formats a `Quantity` for display only — trims trailing zeros past the
 *  decimal point, never feeds the result back into storage or math.
 *  `useGrouping: false` is load-bearing: `parseQuantity` (like
 *  `parseAmount`) treats the *last* "," or "." in the string as the
 *  decimal separator. An integer of 1000+ formatted *with* thousands
 *  grouping (e.g. "1.000") has no real decimal separator at all, so a
 *  round-trip through parseQuantity would misread the grouping dot as
 *  one and silently divide the value by 1000 — exactly the kind of
 *  silent corruption a Quantity exists to prevent. */
export function formatQuantity(q: Quantity): string {
  const value = q / QUANTITY_SCALE
  return value.toLocaleString('es-AR', { maximumFractionDigits: 8, useGrouping: false })
}

/** Half-up rounded `numerator / denominator`, both non-negative — same
 *  symmetric-half-up contract as `domain/money:roundHalfUp`, but done
 *  entirely in `BigInt` so a numerator far past `Number.MAX_SAFE_INTEGER`
 *  (an intermediate product routinely is, even when the final rounded
 *  value is perfectly ordinary — see `valuePosition` below and
 *  `domain/investments/lots.ts:aggregateLots`, its other caller) never
 *  loses precision the way a float division would.
 *
 *  Enforced, not just documented: BigInt division truncates toward zero,
 *  not toward `-Infinity`, so a negative `numerator` would round toward
 *  zero instead of away from it — silently breaking the symmetric
 *  contract this claims to match, rather than throwing. Both callers
 *  only ever pass a non-negative numerator today (a `Quantity` can't be
 *  negative by its own invariant; `Money.amount`/`costPerUnit` isn't
 *  itself sign-checked at the domain-schema level), so this is the
 *  actual backstop against a corrupted or hand-edited backup smuggling
 *  a negative cost into `aggregateLots` and getting a quietly wrong
 *  weighted average instead of a loud rejection. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  invariant(numerator >= 0n, `divideHalfUp: numerator must be non-negative, got ${numerator}`)
  invariant(denominator > 0n, `divideHalfUp: denominator must be positive, got ${denominator}`)
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/** `true` if `n` fits in a `number` without losing precision — the
 *  BigInt equivalent of `Number.isSafeInteger`, for a value that started
 *  life as a `BigInt` computation and needs converting back. */
export function isSafeBigInt(n: bigint): boolean {
  return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)
}

/** Values a position: `quantity × price`, in the price's currency.
 *  Converting to any other currency is a separate step
 *  (`domain/currency/convert`) — this function never does it, so the
 *  order of operations is always quantity -> native value -> conversion,
 *  never a precomputed "value in display currency" shortcut.
 *
 *  The multiplication happens in `BigInt`, not `number`: `q` (scaled by
 *  `QUANTITY_SCALE`, 1e8) times a price that's realistically large for a
 *  peso-denominated instrument (a CEDEAR routinely prices in the tens of
 *  thousands of ARS) produces an intermediate product well past
 *  `Number.MAX_SAFE_INTEGER` long before dividing back down by
 *  `QUANTITY_SCALE` — even though the actual position value (a few
 *  million pesos, say) is perfectly ordinary. Guarding the *intermediate*
 *  product (as this used to) rejects that ordinary case; guarding the
 *  *final* value (after dividing) is what actually matters, since that's
 *  the number that becomes a `Minor` amount. */
export function valuePosition(q: Quantity, price: Money): Money {
  const raw = BigInt(q) * BigInt(price.amount)
  const divided = divideHalfUp(raw, BigInt(QUANTITY_SCALE))
  invariant(isSafeBigInt(divided), `Position value overflows safe integer range (quantity=${q}, price=${price.amount})`)
  return money(Number(divided), price.currency)
}
