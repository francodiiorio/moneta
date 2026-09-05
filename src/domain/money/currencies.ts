export type CurrencyCode = 'ARS' | 'USD' | 'EUR' | (string & {})

export interface CurrencyInfo {
  code: string
  decimals: number
  symbol: string
  locale: string
  /** Show the ISO code ("USD") instead of the currency symbol when
   *  formatting. USD's "$" is indistinguishable from ARS's "$" to this
   *  app's primary audience (Argentina, where ARS is the everyday "$") —
   *  so USD renders as "USD 1,234.56" instead of "$1,234.56". This
   *  collision is specifically a property of formatting USD in the
   *  `en-US` locale below (chosen for its comma-grouping style) — that
   *  locale's native USD symbol is bare "$"; USD formatted in `es-AR`
   *  renders unambiguously as "US$" instead. If a future currency here
   *  also gets a US-style locale for its grouping, re-check whether it
   *  needs this flag too — it's not implied by "is this USD", it's
   *  implied by "does this currency's symbol collide with ARS's `$` in
   *  the locale we chose for it". */
  useCodeDisplay?: boolean
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  ARS: { code: 'ARS', decimals: 2, symbol: '$', locale: 'es-AR' },
  USD: { code: 'USD', decimals: 2, symbol: 'US$', locale: 'en-US', useCodeDisplay: true },
  EUR: { code: 'EUR', decimals: 2, symbol: '€', locale: 'de-DE' },
}

/** Every currency a form's moneda picker can offer — shared so each
 *  feature that lets the user pick a currency (a gasto, a plan, a CSV
 *  import mapping, a saving/investment) doesn't redeclare its own
 *  `Object.keys(CURRENCIES)`. */
export const CURRENCY_CODES = Object.keys(CURRENCIES)

const FALLBACK_LOCALE = 'es-AR'

/** Falls back to a 2-decimal, symbol-less definition for unknown codes
 *  so a backup from a future version with a new currency still renders. */
export function getCurrency(code: CurrencyCode): CurrencyInfo {
  return CURRENCIES[code] ?? { code, decimals: 2, symbol: code, locale: FALLBACK_LOCALE }
}
