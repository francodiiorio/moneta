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

/**
 * Finds the applicable rate for `from -> to` at `date`: the most recent
 * rate on or before `date`. Falls back to the reciprocal of a `to ->
 * from` rate if no direct rate exists. Returns undefined if neither is
 * available — callers decide how to handle a missing rate (the domain
 * layer never invents one).
 */
export function resolveRate(
  rates: readonly ExchangeRate[],
  from: CurrencyCode,
  to: CurrencyCode,
  date: string,
): number | undefined {
  if (from === to) return 1

  const direct = latestOnOrBefore(
    rates.filter((r) => r.from === from && r.to === to),
    date,
  )
  if (direct) return direct.rate

  const reciprocal = latestOnOrBefore(
    rates.filter((r) => r.from === to && r.to === from),
    date,
  )
  if (reciprocal) return 1 / reciprocal.rate

  return undefined
}

function latestOnOrBefore(rates: readonly ExchangeRate[], date: string): ExchangeRate | undefined {
  return rates
    .filter((r) => r.date <= date)
    .reduce<ExchangeRate | undefined>((latest, r) => {
      if (!latest || r.date > latest.date) return r
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
): Money {
  if (amount.currency === toCurrency) return amount
  const rate = resolveRate(rates, amount.currency, toCurrency, date)
  if (rate === undefined) {
    throw new MissingRateError(
      `No exchange rate available for ${amount.currency} -> ${toCurrency} on or before ${date}`,
    )
  }
  const converted: Minor = applyRate(amount.amount, rate)
  return money(converted, toCurrency)
}
