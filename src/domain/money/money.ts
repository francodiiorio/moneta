import { invariant } from '@/lib/invariant'
import type { CurrencyCode } from './currencies'
import { getCurrency } from './currencies'

/**
 * Money is always an integer number of minor units (e.g. cents).
 * Never use `number` with decimals for a monetary amount — see
 * CLAUDE.md "Reglas financieras".
 */
export type Minor = number & { readonly __minorUnit: unique symbol }

export interface Money {
  readonly amount: Minor
  readonly currency: CurrencyCode
}

export function minor(amount: number): Minor {
  invariant(Number.isInteger(amount), `Minor amount must be an integer, got ${amount}`)
  return amount as Minor
}

export function money(amount: number, currency: CurrencyCode): Money {
  return { amount: minor(amount), currency }
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency)
}

function assertSameCurrency(a: Money, b: Money): void {
  invariant(
    a.currency === b.currency,
    `Cannot operate on different currencies: ${a.currency} vs ${b.currency}`,
  )
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.amount + b.amount, a.currency)
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.amount - b.amount, a.currency)
}

export function negate(a: Money): Money {
  return money(-(a.amount as number), a.currency)
}

export function isZero(a: Money): boolean {
  return a.amount === 0
}

export function isPositive(a: Money): boolean {
  return a.amount > 0
}

export function isNegative(a: Money): boolean {
  return a.amount < 0
}

export function sumMoney(currency: CurrencyCode, items: readonly Money[]): Money {
  return items.reduce<Money>((acc, m) => add(acc, m), zero(currency))
}

/** Rounds ties away from zero (symmetric), independent of JS's
 *  round-half-to-+Infinity `Math.round` — required so a rate applied to
 *  a negative amount rounds the same magnitude as its positive mirror. */
export function roundHalfUp(n: number): number {
  return n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5)
}

/** Applies an exchange rate to a minor-unit amount, rounding half-up. */
export function applyRate(amount: Minor, rate: number): Minor {
  invariant(rate > 0, `Exchange rate must be positive, got ${rate}`)
  return minor(roundHalfUp(amount * rate))
}

/**
 * Parses a locale-loose decimal string (accepts "1050", "1050.50",
 * "1.050,50" or "1,050.50") into Money. The decimal separator is
 * assumed to be whichever of "," or "." appears last; digits are
 * truncated (not rounded) past the currency's decimal places.
 */
export function parseAmount(input: string, currency: CurrencyCode): Money {
  const info = getCurrency(currency)
  const cleaned = input.trim().replace(/[^\d.,-]/g, '')
  invariant(cleaned.length > 0, `Cannot parse amount from "${input}"`)

  const isNegative = cleaned.startsWith('-')
  const unsigned = isNegative ? cleaned.slice(1) : cleaned

  const decimalIndex = Math.max(unsigned.lastIndexOf(','), unsigned.lastIndexOf('.'))
  const integerPart =
    decimalIndex === -1 ? unsigned : unsigned.slice(0, decimalIndex).replace(/[.,]/g, '')
  const fractionPart =
    decimalIndex === -1 ? '' : unsigned.slice(decimalIndex + 1).replace(/[^\d]/g, '')

  const paddedFraction = (fractionPart + '0'.repeat(info.decimals)).slice(0, info.decimals)
  const digits = (integerPart.replace(/[.,]/g, '') || '0') + paddedFraction
  const amount = Number.parseInt(digits, 10)
  invariant(Number.isFinite(amount), `Cannot parse amount from "${input}"`)

  return money(isNegative ? -amount : amount, currency)
}

/** Formats Money for display only. Never feed the result back into
 *  storage or arithmetic — the division below is float-precision. */
export function formatMoney(value: Money): string {
  const info = getCurrency(value.currency)
  const decimalValue = value.amount / 10 ** info.decimals
  try {
    return new Intl.NumberFormat(info.locale, {
      style: 'currency',
      currency: info.code,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(decimalValue)
  } catch {
    // info.code isn't a valid ISO 4217 code (e.g. a currency added by a
    // future app version read from an old backup) — fall back to a plain
    // symbol + fixed-point string instead of throwing.
    return `${info.symbol} ${decimalValue.toFixed(info.decimals)}`
  }
}
