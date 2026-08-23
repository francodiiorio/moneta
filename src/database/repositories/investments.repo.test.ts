import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  createInvestmentAsset,
  createInvestmentHolding,
  deleteInvestmentAsset,
  deleteInvestmentHolding,
  listInvestmentAssets,
  listInvestmentHoldings,
  updateInvestmentAsset,
  updateInvestmentHolding,
} from './investments.repo'

afterEach(async () => {
  await Promise.all([db.investmentAssets.clear(), db.investmentHoldings.clear(), db.assetPrices.clear()])
})

describe('createInvestmentAsset / listInvestmentAssets', () => {
  it('creates and lists assets', async () => {
    await createInvestmentAsset({ name: 'SPDR S&P 500', symbol: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const assets = await listInvestmentAssets()
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ symbol: 'SPY', type: 'etf', priceMode: 'manual' })
  })
})

describe('updateInvestmentAsset', () => {
  it('patches the given fields', async () => {
    const asset = await createInvestmentAsset({ name: 'Bitcoin', type: 'crypto', currency: 'USD', priceMode: 'manual' })
    await updateInvestmentAsset(asset.id, { priceMode: 'auto', externalId: 'bitcoin' })
    const [updated] = await listInvestmentAssets()
    expect(updated?.priceMode).toBe('auto')
    expect(updated?.externalId).toBe('bitcoin')
  })
})

describe('deleteInvestmentAsset', () => {
  it('deletes an asset with no holdings, and its price history', async () => {
    const asset = await createInvestmentAsset({ name: 'Bitcoin', type: 'crypto', currency: 'USD', priceMode: 'manual' })
    await db.assetPrices.add({
      id: 'p1',
      assetId: asset.id,
      price: 500000,
      currency: 'USD',
      date: '2026-08-01',
      capturedAt: new Date().toISOString(),
      source: 'manual',
    })

    await deleteInvestmentAsset(asset.id)

    expect(await listInvestmentAssets()).toEqual([])
    expect(await db.assetPrices.where('assetId').equals(asset.id).count()).toBe(0)
  })

  it('refuses to delete an asset that still has holdings', async () => {
    const asset = await createInvestmentAsset({ name: 'Bitcoin', type: 'crypto', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 100_000_000 })

    await expect(deleteInvestmentAsset(asset.id)).rejects.toThrow(/posiciones/)
    expect(await listInvestmentAssets()).toHaveLength(1)
  })
})

describe('createInvestmentHolding / listInvestmentHoldings', () => {
  it('creates a holding for an existing asset', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000, averageCost: 60000 })

    const holdings = await listInvestmentHoldings()
    expect(holdings).toHaveLength(1)
    expect(holdings[0]).toMatchObject({ assetId: asset.id, quantity: 500_000_000, averageCost: 60000 })
  })

  it('rejects a holding for a non-existent asset', async () => {
    await expect(createInvestmentHolding({ assetId: 'missing', quantity: 100 })).rejects.toThrow(/no encontrado/)
  })
})

describe('updateInvestmentHolding / deleteInvestmentHolding', () => {
  it('patches quantity and removes a holding', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const holding = await createInvestmentHolding({ assetId: asset.id, quantity: 100 })

    await updateInvestmentHolding(holding.id, { quantity: 200 })
    expect((await listInvestmentHoldings())[0]?.quantity).toBe(200)

    await deleteInvestmentHolding(holding.id)
    expect(await listInvestmentHoldings()).toEqual([])
  })
})
