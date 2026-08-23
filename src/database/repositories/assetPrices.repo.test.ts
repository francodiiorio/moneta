import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createAssetPrice, latestAssetPrices, listAssetPrices } from './assetPrices.repo'

afterEach(async () => {
  await db.assetPrices.clear()
})

describe('createAssetPrice', () => {
  it('rejects a non-positive price', async () => {
    await expect(
      createAssetPrice({ assetId: 'a1', price: 0, currency: 'USD', date: '2026-08-01', source: 'manual' }),
    ).rejects.toThrow(/mayor a cero/)
  })

  it('is append-only: creating twice keeps both rows instead of replacing', async () => {
    await createAssetPrice({ assetId: 'a1', price: 65000, currency: 'USD', date: '2026-08-01', source: 'manual' })
    await createAssetPrice({ assetId: 'a1', price: 66000, currency: 'USD', date: '2026-08-02', source: 'manual' })
    expect(await listAssetPrices('a1')).toHaveLength(2)
  })
})

describe('listAssetPrices', () => {
  it('returns most recent first', async () => {
    await createAssetPrice({ assetId: 'a1', price: 65000, currency: 'USD', date: '2026-08-01', source: 'manual' })
    await createAssetPrice({ assetId: 'a1', price: 67000, currency: 'USD', date: '2026-08-03', source: 'manual' })
    await createAssetPrice({ assetId: 'a1', price: 66000, currency: 'USD', date: '2026-08-02', source: 'manual' })

    const prices = await listAssetPrices('a1')
    expect(prices.map((p) => p.date)).toEqual(['2026-08-03', '2026-08-02', '2026-08-01'])
  })
})

describe('latestAssetPrices', () => {
  it('returns only the most recent price per asset', async () => {
    await createAssetPrice({ assetId: 'a1', price: 65000, currency: 'USD', date: '2026-08-01', source: 'manual' })
    await createAssetPrice({ assetId: 'a1', price: 67000, currency: 'USD', date: '2026-08-03', source: 'automatic' })
    await createAssetPrice({ assetId: 'a2', price: 500, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const latest = await latestAssetPrices(['a1', 'a2', 'a3'], '2026-08-23')
    expect(latest.get('a1')?.price).toBe(67000)
    expect(latest.get('a2')?.price).toBe(500)
    expect(latest.has('a3')).toBe(false)
  })

  it('ignores a price dated after asOfDate, even if it is the most recently captured one', async () => {
    await createAssetPrice({ assetId: 'a1', price: 65000, currency: 'USD', date: '2026-08-01', source: 'manual' })
    await createAssetPrice({ assetId: 'a1', price: 99999, currency: 'USD', date: '2026-09-15', source: 'manual' })

    const latest = await latestAssetPrices(['a1'], '2026-08-23')
    expect(latest.get('a1')?.price).toBe(65000)
  })

  it('returns an empty map for an empty asset list', async () => {
    expect(await latestAssetPrices([], '2026-08-23')).toEqual(new Map())
  })
})
