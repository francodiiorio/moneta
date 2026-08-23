import type { Money } from '@/domain/money'
import { money, roundHalfUp } from '@/domain/money'
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
 *  decimal point, never feeds the result back into storage or math. */
export function formatQuantity(q: Quantity): string {
  const value = q / QUANTITY_SCALE
  return value.toLocaleString('es-AR', { maximumFractionDigits: 8 })
}

/** Values a position: `quantity × price`, in the price's currency.
 *  Converting to any other currency is a separate step
 *  (`domain/currency/convert`) — this function never does it, so the
 *  order of operations is always quantity -> native value -> conversion,
 *  never a precomputed "value in display currency" shortcut. */
export function valuePosition(q: Quantity, price: Money): Money {
  const raw = q * price.amount
  invariant(
    Number.isSafeInteger(raw),
    `Position value overflows safe integer range (quantity=${q}, price=${price.amount})`,
  )
  return money(roundHalfUp(raw / QUANTITY_SCALE), price.currency)
}
