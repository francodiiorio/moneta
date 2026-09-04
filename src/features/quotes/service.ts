import { assetPricesRepo, exchangeRatesRepo, investmentsRepo, settingsRepo } from '@/database/repositories'
import { isPositive, moneyFromNumber } from '@/domain/money'
import type { InvestmentAsset } from '@/domain/entities'
import { fetchCoinGeckoPrices, fetchData912CedearPrices, fetchDolarApiRates, fetchFrankfurterRate } from './providers'
import type { PriceQuote } from './providers/types'

export const STALE_HOURS = 12

/** A quote older than `hours` (or never captured) counts as stale — used
 *  to decide whether to refresh on app open. `capturedAt` undefined
 *  (never refreshed) is always stale. */
export function isStale(capturedAt: string | undefined, hours: number = STALE_HOURS): boolean {
  if (!capturedAt) return true
  const ageMs = Date.now() - new Date(capturedAt).getTime()
  return ageMs > hours * 60 * 60 * 1000
}

export interface RefreshResult {
  ratesAdded: number
  pricesAdded: number
  /** Names of providers that failed or had nothing to report — the UI
   *  reports these, never silently drops them. */
  failed: string[]
}

/**
 * Fetches from every automatic provider and writes whatever succeeded.
 * One provider failing never blocks another (each is awaited in
 * parallel, and a provider function itself never throws — see
 * providers/*.ts). Never touches or deletes a previously-loaded rate or
 * price: on a total failure this simply adds nothing, and the last valid
 * quote already in IndexedDB keeps being used — see "Fallos de API" in
 * docs/DECISIONS.md. Only ever called when `Settings.autoQuotesEnabled`
 * is true; the caller is responsible for that check.
 */
export async function refreshQuotes(): Promise<RefreshResult> {
  const assets = await investmentsRepo.listInvestmentAssets()
  // The filter that decides who's eligible for an automatic price —
  // reused below to look up each eligible asset's quote, rather than a
  // Map keyed by externalId (which would silently drop every asset but
  // the last whenever two assets share the same CoinGecko id — a real
  // case, e.g. the same coin split across two wallets as separate
  // holdings).
  const autoCryptoAssets = assets.filter(
    (a): a is typeof a & { externalId: string } => a.type === 'crypto' && a.priceMode === 'auto' && !!a.externalId,
  )
  const autoCedearAssets = assets.filter(
    (a): a is typeof a & { externalId: string } => a.type === 'cedear' && a.priceMode === 'auto' && !!a.externalId,
  )

  const [dolarRates, eurUsdRate, cryptoPrices, cedearPrices] = await Promise.all([
    fetchDolarApiRates(),
    fetchFrankfurterRate('EUR', 'USD'),
    fetchCoinGeckoPrices(autoCryptoAssets.map((a) => a.externalId)),
    // data912 has no per-symbol query (it always returns every CEDEAR it
    // knows about), so it's only worth calling when some asset actually
    // needs it — same privacy-minded reasoning as never requesting
    // anything the app doesn't need.
    autoCedearAssets.length > 0 ? fetchData912CedearPrices() : Promise.resolve([]),
  ])

  const failed: string[] = []
  if (dolarRates.length === 0) failed.push('dolarapi')
  if (!eurUsdRate) failed.push('frankfurter')
  if (autoCryptoAssets.length > 0 && cryptoPrices.length === 0) failed.push('coingecko')
  if (autoCedearAssets.length > 0 && cedearPrices.length === 0) failed.push('data912')

  let ratesAdded = 0
  for (const quote of [...dolarRates, ...(eurUsdRate ? [eurUsdRate] : [])]) {
    try {
      await exchangeRatesRepo.createExchangeRate({
        date: quote.date,
        from: quote.from,
        to: quote.to,
        rate: quote.rate,
        source: 'automatic',
        ...(quote.profile !== undefined && { profile: quote.profile }),
      })
      ratesAdded++
    } catch {
      // A single malformed quote (shouldn't happen — providers already
      // filter to positive rates) doesn't block the rest.
    }
  }

  // One map per provider, never merged: two different providers' quotes
  // must never compete for the same externalId key. `externalId` is
  // free text (not validated against any provider), so nothing stops a
  // `crypto` and a `cedear` asset from sharing the same string (a typo,
  // or two devices merged via backup) — a single shared map would then
  // silently hand one asset a quote meant for a completely different
  // instrument, in a different currency. Iterating each provider's own
  // eligible assets against its own map (rather than one map shared by
  // key) is also what already avoids the "two assets, same externalId"
  // collision within a single provider (see the filter's docstring
  // above).
  let pricesAdded = 0
  pricesAdded += await applyQuotes(autoCryptoAssets, cryptoPrices)
  pricesAdded += await applyQuotes(autoCedearAssets, cedearPrices)

  await settingsRepo.updateSettings({ quotesRefreshedAt: new Date().toISOString() })

  return { ratesAdded, pricesAdded, failed }
}

/** Writes one `AssetPrice` per asset in `assets` that has a matching
 *  quote in `quotes` (matched by `externalId`, scoped to a single
 *  provider's own quotes — see `refreshQuotes`'s docstring on why these
 *  are never merged across providers). Returns how many were actually
 *  written. */
async function applyQuotes(
  assets: readonly (InvestmentAsset & { externalId: string })[],
  quotes: readonly PriceQuote[],
): Promise<number> {
  const quoteByExternalId = new Map(quotes.map((q) => [q.externalId, q]))
  let added = 0
  for (const asset of assets) {
    const quote = quoteByExternalId.get(asset.externalId)
    if (!quote) continue
    // A price that rounds to 0 in the asset's currency (a sub-cent coin
    // in a 2-decimal currency) can't be represented — skip it rather
    // than let createAssetPrice's `price > 0` invariant throw as a
    // control-flow shortcut. Same reasoning as a missing quote: this
    // asset just doesn't get updated this round.
    const price = moneyFromNumber(quote.price, quote.currency)
    if (!isPositive(price)) continue
    try {
      await assetPricesRepo.createAssetPrice({
        assetId: asset.id,
        price: price.amount,
        currency: quote.currency,
        date: quote.date,
        source: 'automatic',
      })
      added++
    } catch {
      // Any other unexpected failure for this one asset doesn't block the rest.
    }
  }
  return added
}
