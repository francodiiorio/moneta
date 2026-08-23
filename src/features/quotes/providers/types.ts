/** A single exchange rate as reported by a provider — always `from -> to`,
 *  `rate` a bare ratio (never Money, same reasoning as
 *  `ExchangeRate.rate`). `profile` identifies the reference (e.g. 'mep',
 *  'blue') when the provider distinguishes more than one for the same
 *  pair; omit it for a single generic rate. */
export interface RateQuote {
  from: string
  to: string
  rate: number
  date: string
  profile?: string
}

/** A single asset price as reported by a provider. `price`/`currency` are
 *  in major units — the caller (features/quotes/service.ts) converts to
 *  `Minor` before persisting, same as any other user-facing amount. */
export interface PriceQuote {
  externalId: string
  price: number
  currency: string
  date: string
}
