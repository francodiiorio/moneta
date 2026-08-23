import { db } from '../db'
import type { AssetPrice } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'

export interface CreateAssetPriceInput {
  assetId: string
  price: AssetPrice['price']
  currency: AssetPrice['currency']
  date: AssetPrice['date']
  source: AssetPrice['source']
}

/** Append-only: a price is never updated or replaced in place, only
 *  inserted anew — see docs/DECISIONS.md. This is what makes a price
 *  history come for free, and what lets a manual override coexist with
 *  automatic quotes without special-casing (the most recent row wins). */
export async function createAssetPrice(input: CreateAssetPriceInput): Promise<AssetPrice> {
  invariant(input.price > 0, `El precio debe ser mayor a cero, recibido: ${input.price}`)

  const price: AssetPrice = {
    id: generateId(),
    assetId: input.assetId,
    price: input.price,
    currency: input.currency,
    date: input.date,
    source: input.source,
    capturedAt: new Date().toISOString(),
  }
  await db.assetPrices.add(price)
  return price
}

// Ties on `date` (e.g. two automatic refreshes the same day) break on
// `capturedAt`, which has full timestamp precision — `date` alone is only
// the quote's as-of day.
function byMostRecent(a: AssetPrice, b: AssetPrice): number {
  return a.date === b.date ? a.capturedAt.localeCompare(b.capturedAt) : a.date.localeCompare(b.date)
}

export async function listAssetPrices(assetId: string): Promise<AssetPrice[]> {
  const prices = await db.assetPrices.where('assetId').equals(assetId).toArray()
  return prices.sort(byMostRecent).reverse() // most recent first, for display
}

/** The most recent price known for each asset in `assetIds`, on or before
 *  `asOfDate` — same "latest on or before" semantics as
 *  domain/currency/rates.ts:resolveRate, mirrored here rather than shared
 *  because a price is keyed by assetId, not a currency pair. A price
 *  dated after `asOfDate` (e.g. a stray future-dated row from a backup)
 *  never wins, even if it's the most recently captured one. */
export async function latestAssetPrices(
  assetIds: readonly string[],
  asOfDate: string,
): Promise<Map<string, AssetPrice>> {
  if (assetIds.length === 0) return new Map()

  const prices = await db.assetPrices.where('assetId').anyOf(assetIds).toArray()
  const byAsset = new Map<string, AssetPrice[]>()
  for (const price of prices) {
    if (price.date > asOfDate) continue
    const list = byAsset.get(price.assetId) ?? []
    list.push(price)
    byAsset.set(price.assetId, list)
  }

  const latest = new Map<string, AssetPrice>()
  for (const [assetId, list] of byAsset) {
    const mostRecent = list.sort(byMostRecent)[list.length - 1]
    if (mostRecent) latest.set(assetId, mostRecent)
  }
  return latest
}
