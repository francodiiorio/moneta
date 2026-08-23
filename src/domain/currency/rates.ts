import type { CurrencyCode } from '@/domain/money'
import { applyRate, type Minor, type Money, money } from '@/domain/money'
import type { ExchangeRate } from '@/domain/entities'

/** Thrown only for a missing rate — callers that want to treat that case
 *  specially (e.g. count it instead of aborting) can distinguish it from
 *  any other, unexpected error `applyRate`/`convert` might raise. */
export class MissingRateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingRateError'
  }
}

/** Narrows `pairs` to the rate(s) matching `profile` (e.g. 'mep', 'blue')
 *  when one is requested and at least one such rate exists; otherwise
 *  falls back to rates with no `profile` at all — a rate loaded before
 *  the field existed, or entered as a generic one-off, still matches any
 *  request. A profile request never silently falls back to a *different*
 *  profile's rate. */
function candidatesFor(pairs: readonly ExchangeRate[], profile: string | undefined): readonly ExchangeRate[] {
  if (profile) {
    const withProfile = pairs.filter((r) => r.profile === profile)
    if (withProfile.length > 0) return withProfile
  }
  return pairs.filter((r) => r.profile === undefined)
}

function directOrReciprocal(
  rates: readonly ExchangeRate[],
  from: CurrencyCode,
  to: CurrencyCode,
  date: string,
  profile: string | undefined,
): number | undefined {
  if (from === to) return 1

  const direct = latestOnOrBefore(
    candidatesFor(
      rates.filter((r) => r.from === from && r.to === to),
      profile,
    ),
    date,
  )
  if (direct) return direct.rate

  const reciprocal = latestOnOrBefore(
    candidatesFor(
      rates.filter((r) => r.from === to && r.to === from),
      profile,
    ),
    date,
  )
  if (reciprocal) return 1 / reciprocal.rate

  return undefined
}

/**
 * Finds the applicable rate for `from -> to` at `date`: the most recent
 * rate on or before `date` (direct, or the reciprocal of `to -> from` if
 * no direct rate exists), preferring `profile` when given (see
 * `candidatesFor`). If neither side has a usable rate, triangulates
 * through USD as a last resort — e.g. EUR -> ARS via EUR -> USD and
 * USD -> ARS — since that's the one pivot currency the app assumes
 * everyone has *some* rate against. Returns undefined only if even that
 * fails; callers decide how to handle a missing rate (the domain layer
 * never invents one).
 */
export function resolveRate(
  rates: readonly ExchangeRate[],
  from: CurrencyCode,
  to: CurrencyCode,
  date: string,
  profile?: string,
): number | undefined {
  const direct = directOrReciprocal(rates, from, to, date, profile)
  if (direct !== undefined) return direct

  if (from !== 'USD' && to !== 'USD') {
    const toUsd = directOrReciprocal(rates, from, 'USD', date, profile)
    const fromUsd = directOrReciprocal(rates, 'USD', to, date, profile)
    if (toUsd !== undefined && fromUsd !== undefined) return toUsd * fromUsd
  }

  return undefined
}

/** On a `date` tie (e.g. an automatic morning fetch and a manual
 *  afternoon correction loaded the same day), `capturedAt` — full
 *  timestamp precision — breaks it in favor of whichever was actually
 *  entered more recently. A rate with no `capturedAt` (loaded before the
 *  field existed) only wins a tie against another rate that also lacks
 *  one; it never beats a rate that has one, so an old undated row can't
 *  shadow a real correction. */
function isMoreRecent(candidate: ExchangeRate, current: ExchangeRate): boolean {
  if (candidate.date !== current.date) return candidate.date > current.date
  if (candidate.capturedAt && current.capturedAt) return candidate.capturedAt > current.capturedAt
  // Exactly one side has a capturedAt: the dated one wins regardless of
  // which was encountered first — an old undated row can't shadow a
  // real, timestamped correction just by iterating before it.
  if (candidate.capturedAt && !current.capturedAt) return true
  return false
}

function latestOnOrBefore(rates: readonly ExchangeRate[], date: string): ExchangeRate | undefined {
  return rates
    .filter((r) => r.date <= date)
    .reduce<ExchangeRate | undefined>((latest, r) => {
      if (!latest || isMoreRecent(r, latest)) return r
      return latest
    }, undefined)
}

/** Converts an amount using a known rate. Throws if the rate can't be
 *  resolved — surfacing a missing rate is safer than pretending 1:1. */
export function convert(
  amount: Money,
  toCurrency: CurrencyCode,
  rates: readonly ExchangeRate[],
  date: string,
  profile?: string,
): Money {
  if (amount.currency === toCurrency) return amount
  const rate = resolveRate(rates, amount.currency, toCurrency, date, profile)
  if (rate === undefined) {
    throw new MissingRateError(
      `No exchange rate available for ${amount.currency} -> ${toCurrency} on or before ${date}`,
    )
  }
  const converted: Minor = applyRate(amount.amount, rate)
  return money(converted, toCurrency)
}
