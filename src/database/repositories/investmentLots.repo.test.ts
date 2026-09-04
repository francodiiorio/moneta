import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createInvestmentAsset } from './investments.repo'
import {
  createInvestmentLot,
  deleteInvestmentLot,
  getInvestmentLot,
  listInvestmentLots,
  updateInvestmentLot,
} from './investmentLots.repo'

afterEach(async () => {
  await Promise.all([db.investmentAssets.clear(), db.investmentHoldings.clear(), db.investmentLots.clear()])
})

describe('createInvestmentLot', () => {
  it('creates the first lot and upserts the holding aggregate to match it exactly', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentLot({ assetId: asset.id, quantity: 500_000_000, costPerUnit: 60000, currency: 'USD', date: '2026-01-01' })

    const lots = await listInvestmentLots(asset.id)
    expect(lots).toHaveLength(1)
    expect(lots[0]).toMatchObject({ assetId: asset.id, quantity: 500_000_000, costPerUnit: 60000, currency: 'USD', date: '2026-01-01' })

    const [holding] = await db.investmentHoldings.toArray()
    expect(holding).toMatchObject({ assetId: asset.id, quantity: 500_000_000, averageCost: 60000 })
  })

  it('recomputes the weighted average when a second lot is added', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentLot({ assetId: asset.id, quantity: 5 * 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })
    await createInvestmentLot({ assetId: asset.id, quantity: 3 * 100_000_000, costPerUnit: 12_000, currency: 'USD', date: '2026-02-01' })

    const [holding] = await db.investmentHoldings.toArray()
    // (5*100 + 3*120) / 8 = 107,50
    expect(holding).toMatchObject({ quantity: 8 * 100_000_000, averageCost: 10_750 })
  })

  it('rejects a lot for a non-existent asset', async () => {
    await expect(
      createInvestmentLot({ assetId: 'missing', quantity: 100, currency: 'USD', date: '2026-01-01' }),
    ).rejects.toThrow(/no encontrado/)
  })

  it('rejects a lot whose currency does not match the asset', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await expect(
      createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, currency: 'EUR', date: '2026-01-01' }),
    ).rejects.toThrow(/moneda/i)
  })
})

describe('updateInvestmentLot / deleteInvestmentLot', () => {
  it('recomputes the aggregate after editing a lot', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })

    await updateInvestmentLot(lot.id, { quantity: 200_000_000 })

    expect((await getInvestmentLot(lot.id))?.quantity).toBe(200_000_000)
    const [holding] = await db.investmentHoldings.toArray()
    expect(holding?.quantity).toBe(200_000_000)
  })

  it('deletes the holding aggregate once its only lot is deleted', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })

    await deleteInvestmentLot(lot.id)

    expect(await listInvestmentLots(asset.id)).toEqual([])
    expect(await db.investmentHoldings.toArray()).toEqual([])
  })

  it('recomputes (not deletes) the aggregate when one of several lots is deleted', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const first = await createInvestmentLot({ assetId: asset.id, quantity: 5 * 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })
    await createInvestmentLot({ assetId: asset.id, quantity: 3 * 100_000_000, costPerUnit: 12_000, currency: 'USD', date: '2026-02-01' })

    await deleteInvestmentLot(first.id)

    const [holding] = await db.investmentHoldings.toArray()
    expect(holding).toMatchObject({ quantity: 3 * 100_000_000, averageCost: 12_000 })
  })

  // Regression: an aggregate can lose its cost basis entirely, not just
  // change value — e.g. the only costed lot gets deleted, leaving only
  // uncosted ones. `.put()` (full replace) inside recomputeHoldingAggregate
  // is what makes this actually work — `.update()` can't remove a field
  // that's simply absent from a patch.
  it('drops the holding\'s averageCost entirely once its only costed lot is gone', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const costed = await createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })
    await createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, currency: 'USD', date: '2026-02-01' })

    await deleteInvestmentLot(costed.id)

    const [holding] = await db.investmentHoldings.toArray()
    expect(holding?.quantity).toBe(100_000_000)
    expect(holding?.averageCost).toBeUndefined()
  })

  // Regression: editing a lot to explicitly clear its costPerUnit must
  // actually clear the stored field, not just skip it. Dexie's
  // update()/modify() leaves a key absent from the patch untouched — the
  // same characteristic that motivated recomputeHoldingAggregate's own
  // put()-not-update() fix above, but for the lot row itself this time.
  it('clears a lot\'s own costPerUnit when explicitly nulled, recomputing the holding without it', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })

    await updateInvestmentLot(lot.id, { costPerUnit: null })

    expect((await getInvestmentLot(lot.id))?.costPerUnit).toBeUndefined()
    const [holding] = await db.investmentHoldings.toArray()
    expect(holding?.averageCost).toBeUndefined()
  })

  it('leaves an untouched costPerUnit alone when omitted from the patch', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })

    await updateInvestmentLot(lot.id, { quantity: 200_000_000 })

    expect((await getInvestmentLot(lot.id))?.costPerUnit).toBe(10_000)
  })
})
