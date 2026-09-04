import { z } from 'zod'
import { todayStamp } from '@/lib/dates'
import type { PriceQuote } from './types'

/** One of the few places in the app that makes a network request — see
 *  frankfurter.ts's docblock for the privacy rationale, which applies
 *  here identically. The endpoint always returns every CEDEAR it knows
 *  about (there's no per-symbol query), so nothing asset-specific is
 *  ever sent — only the fact that the request happened.
 *
 *  data912.com (https://data912.com) is a free, key-less, CORS-enabled
 *  mirror of BYMA (Bolsas y Mercados Argentinos) market data, run by the
 *  Argentine fintech community — verified against a real request before
 *  wiring this up (see docs/DECISIONS.md). It's the only automatic
 *  provider for CEDEARs: stocks/ETFs/bonds/FCI still have no equivalent
 *  free, key-less, CORS-enabled source, so those stay manual-only. Being
 *  an unofficial community mirror rather than BYMA itself or a broker,
 *  it carries no uptime guarantee — refreshQuotes() already tolerates
 *  that the same way it tolerates any other provider going down. */
const rowSchema = z.object({ symbol: z.string(), c: z.number() })
const responseSchema = z.array(rowSchema)

/** Never throws — see fetchFrankfurterRate's docblock for why. `externalId`
 *  is the BYMA ticker itself (e.g. "KO", "SPY") — unlike CoinGecko's coin
 *  id, it's usually the same string the user already knows as the
 *  CEDEAR's symbol. `c` is the last traded price, always in ARS (a CEDEAR
 *  only ever trades in pesos on BYMA). */
export async function fetchData912CedearPrices(): Promise<PriceQuote[]> {
  try {
    const response = await fetch('https://data912.com/live/arg_cedears', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return []

    const parsed = responseSchema.safeParse(await response.json())
    if (!parsed.success) return []

    const date = todayStamp()
    return parsed.data.filter((row) => row.c > 0).map((row) => ({ externalId: row.symbol, price: row.c, currency: 'ARS', date }))
  } catch {
    return []
  }
}
