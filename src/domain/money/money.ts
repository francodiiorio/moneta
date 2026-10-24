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

/** The same amount without its sign — e.g. a gasto shown negated in a
 *  list, back to the positive magnitude its form edits. */
export function magnitude(a: Money): Money {
  return a.amount < 0 ? negate(a) : a
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

/** `true` when `parts` (a number split on one separator) read as
 *  thousands grouping: a 1–3 digit leading group without a leading zero,
 *  then only full 3-digit groups ("900.000", "1.000.000"). */
function isThousandsGrouping(parts: readonly string[]): boolean {
  const [head, ...groups] = parts
  return /^[1-9]\d{0,2}$/.test(head ?? '') && groups.length > 0 && groups.every((g) => /^\d{3}$/.test(g))
}

/**
 * Index of the decimal separator in an unsigned, already-cleaned amount,
 * or -1 when every separator is thousands grouping. Follows es-AR (the
 * app's locale: "." groups thousands, "," is the decimal) while still
 * accepting a dot-decimal where it can't be anything else:
 * - both "," and "." present → the last one is the decimal ("1.050,50",
 *   "1,050.50");
 * - one separator kind, repeated → grouping if it groups properly
 *   ("1.000.000", "1,000,000"), else the last one is the decimal;
 * - a single "." → grouping only if it groups properly ("900.000",
 *   "1.500"), otherwise a decimal ("1.5", "10.25", "0.500");
 * - a single "," → always the decimal ("1,5", "1,500" = 1,50).
 * See ADR "Montos: el punto es separador de miles" in docs/DECISIONS.md.
 */
function decimalSeparatorIndex(unsigned: string): number {
  const lastComma = unsigned.lastIndexOf(',')
  const lastDot = unsigned.lastIndexOf('.')
  if (lastComma === -1 && lastDot === -1) return -1
  if (lastComma !== -1 && lastDot !== -1) return Math.max(lastComma, lastDot)

  const separator = lastDot !== -1 ? '.' : ','
  const parts = unsigned.split(separator)
  const groupsAsThousands = parts.length > 2 || separator === '.'
  if (groupsAsThousands && isThousandsGrouping(parts)) return -1
  return unsigned.lastIndexOf(separator)
}

/**
 * Parses a user-typed amount ("1050", "900.000", "1.050,50", "1,050.50",
 * "10.25") into Money — see `decimalSeparatorIndex` for which separator
 * is the decimal. Digits are truncated (not rounded) past the currency's
 * decimal places.
 */
export function parseAmount(input: string, currency: CurrencyCode): Money {
  const info = getCurrency(currency)
  const cleaned = input.trim().replace(/[^\d.,-]/g, '')
  invariant(cleaned.length > 0, `Cannot parse amount from "${input}"`)

  // One sign at most, leading or trailing (some bank exports write
  // "1.500,00-"); anything else — "--1.500", "1-500" — is malformed, and
  // guessing a sign for a money amount is worse than refusing it.
  const minusCount = (cleaned.match(/-/g) ?? []).length
  const isNegative = minusCount === 1 && (cleaned.startsWith('-') || cleaned.endsWith('-'))
  invariant(minusCount === 0 || isNegative, `Monto inválido: "${input}"`)
  const unsigned = cleaned.replace('-', '')
  // "1..000" or "1.,5": no reading of that is the one the user meant.
  invariant(!/[.,]{2}/.test(unsigned), `Monto inválido: "${input}"`)

  const decimalIndex = decimalSeparatorIndex(unsigned)
  const integerPart =
    decimalIndex === -1 ? unsigned : unsigned.slice(0, decimalIndex).replace(/[.,]/g, '')
  const fractionPart =
    decimalIndex === -1 ? '' : unsigned.slice(decimalIndex + 1).replace(/[^\d]/g, '')

  const paddedFraction = (fractionPart + '0'.repeat(info.decimals)).slice(0, info.decimals)
  const digits = (integerPart.replace(/[.,]/g, '') || '0') + paddedFraction
  const amount = Number.parseInt(digits, 10)
  invariant(Number.isFinite(amount), `Cannot parse amount from "${input}"`)
  // Past 2^53 a `number` can't hold every integer: the stored Minor would
  // silently differ from what was typed.
  invariant(Number.isSafeInteger(amount), `Monto demasiado grande: "${input}"`)

  return money(isNegative ? -amount : amount, currency)
}

/**
 * Converts a raw JS number (already in major units — e.g. `77408.12`
 * parsed from an API's JSON response) into Money, rounding half-up.
 * Never use `parseAmount` for this: it's built for locale-loose text a
 * user typed, and `String(aVerySmallNumber)` can produce scientific
 * notation ("1.2e-7") that `parseAmount` rejects (or, without a minus
 * sign in it, would misread).
 * This function skips string round-tripping entirely.
 */
export function moneyFromNumber(value: number, currency: CurrencyCode): Money {
  const info = getCurrency(currency)
  return money(roundHalfUp(value * 10 ** info.decimals), currency)
}

/** Percent change from `previous` to `current`, for display only (a
 *  "+12% vs. mes anterior" badge) — never stored or fed back into a
 *  monetary calculation, same exception as `formatMoney`. Returns
 *  `undefined` when `previous` is zero: "up 100%", "up infinitely",
 *  and "up from nothing" all round to the same unhelpful number, so
 *  callers should render nothing rather than a misleading percentage.
 *  Meaningful only for non-negative magnitudes (e.g. income, expense
 *  totals) — a signed amount that can cross zero (e.g. net balance)
 *  makes the sign of the result flip in confusing ways. */
export function percentChange(previous: Money, current: Money): number | undefined {
  assertSameCurrency(previous, current)
  invariant(
    previous.amount >= 0 && current.amount >= 0,
    'percentChange expects non-negative magnitudes (e.g. income/expense totals), not a signed balance',
  )
  if (previous.amount === 0) return undefined
  return ((current.amount - previous.amount) / previous.amount) * 100
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
      ...(info.useCodeDisplay && { currencyDisplay: 'code' }),
    }).format(decimalValue)
  } catch {
    // info.code isn't a valid ISO 4217 code (e.g. a currency added by a
    // future app version read from an old backup) — fall back to a plain
    // symbol + fixed-point string instead of throwing.
    return `${info.symbol} ${decimalValue.toFixed(info.decimals)}`
  }
}

/** Formats a raw amount in `currency`'s minor units for a chart axis tick
 *  — grouped thousands, no currency symbol/decimals. Deliberately separate
 *  from formatMoney: a charting library computes its own "nice" tick
 *  values by interpolating across the data's domain, so the input here
 *  isn't guaranteed to be a whole minor unit the way a real stored Money
 *  amount is — this skips the strict integer `Minor` invariant on purpose.
 *  Display only, same rule as formatMoney otherwise: never feed the
 *  result back into storage or arithmetic. */
export function formatAxisAmount(rawMinorValue: number, currency: CurrencyCode): string {
  const info = getCurrency(currency)
  const decimalValue = rawMinorValue / 10 ** info.decimals
  return new Intl.NumberFormat(info.locale, { maximumFractionDigits: 0 }).format(decimalValue)
}

/** The text an amount input is pre-filled with when editing: what
 *  `formatMoney` shows, without the currency symbol — so `parseAmount`
 *  reads it back to exactly the same Money (both use the app's es-AR
 *  separators; see money.test.ts "round-trips"). The one place that
 *  strips a formatted amount for an input. */
export function formatAmountInput(value: Money): string {
  return formatMoney(value).replace(/[^\d,.-]/g, '')
}

/** `parseAmount` for live previews while the user types, any sign:
 *  `undefined` for anything not (yet) readable — never throws. An
 *  accounting-style negative "(1.234,56)" is refused rather than read as
 *  positive (`parseAmount` drops the parentheses). Saving parses again. */
export function tryParseAmount(input: string, currency: CurrencyCode): Money | undefined {
  if (!/\d/.test(input) || /[()]/.test(input)) return undefined
  try {
    return parseAmount(input, currency)
  } catch {
    return undefined
  }
}

/** `tryParseAmount`, only a positive amount. */
export function tryParsePositiveAmount(input: string, currency: CurrencyCode): Money | undefined {
  const parsed = tryParseAmount(input, currency)
  return parsed && parsed.amount > 0 ? parsed : undefined
}
