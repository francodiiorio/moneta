import { z } from 'zod'
import { todayStamp } from '@/lib/dates'
import type { PriceQuote } from './types'

/** One of the few places in the app that makes a network request — see
 *  frankfurter.ts's docblock for the privacy rationale, which applies
 *  here identically. Sends only the asset's own `externalId`s (public
 *  CoinGecko coin ids like "bitcoin") — never any account, balance, or
 *  quantity data.
 *
 *  CoinGecko (https://coingecko.com) is a free, key-less, CORS-enabled
 *  crypto price API — verified against a real request before wiring this
 *  up (see docs/DECISIONS.md). It's the only provider used for crypto:
 *  stocks/ETFs/CEDEARs/bonds/FCI have no equivalent free, key-less,
 *  CORS-enabled source, so those stay manual-only (same ADR). */
const responseSchema = z.record(z.string(), z.object({ usd: z.number() }))

/** Never throws — see fetchFrankfurterRate's docblock for why. Prices
 *  come back vs. USD only (CoinGecko's `simple/price` endpoint), which is
 *  fine here since crypto `InvestmentAsset`s are expected to be priced in
 *  USD — `currency` is still returned explicitly rather than assumed by
 *  the caller. */
export async function fetchCoinGeckoPrices(coinIds: readonly string[]): Promise<PriceQuote[]> {
  if (coinIds.length === 0) return []

  try {
    const ids = encodeURIComponent(coinIds.join(','))
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return []

    const parsed = responseSchema.safeParse(await response.json())
    if (!parsed.success) return []

    const date = todayStamp()
    return Object.entries(parsed.data)
      .filter(([, value]) => value.usd > 0)
      .map(([externalId, value]) => ({ externalId, price: value.usd, currency: 'USD', date }))
  } catch {
    return []
  }
}
