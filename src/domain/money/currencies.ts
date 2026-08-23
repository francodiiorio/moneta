export type CurrencyCode = 'ARS' | 'USD' | 'EUR' | (string & {})

export interface CurrencyInfo {
  code: string
  decimals: number
  symbol: string
  locale: string
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  ARS: { code: 'ARS', decimals: 2, symbol: '$', locale: 'es-AR' },
  USD: { code: 'USD', decimals: 2, symbol: 'US$', locale: 'en-US' },
  EUR: { code: 'EUR', decimals: 2, symbol: '€', locale: 'de-DE' },
}

const FALLBACK_LOCALE = 'es-AR'

/** Falls back to a 2-decimal, symbol-less definition for unknown codes
 *  so a backup from a future version with a new currency still renders. */
export function getCurrency(code: CurrencyCode): CurrencyInfo {
  return CURRENCIES[code] ?? { code, decimals: 2, symbol: code, locale: FALLBACK_LOCALE }
}
