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
  await Promise.all([
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.investmentLots.clear(),
  ])
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

describe('cuenta de origen (Etapa 8, Fase 3)', () => {
  afterEach(async () => {
    await db.accounts.clear()
  })

  async function setup() {
    const { createAccount } = await import('./accounts.repo')
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const usd = await createAccount({ name: 'Caja USD', type: 'bank', currency: 'USD', openingBalance: 0, openingDate: '2026-10-01' })
    const ars = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-10-01' })
    return { asset, usd, ars }
  }

  const base = { quantity: 500_000_000, currency: 'USD', date: '2026-10-09' }

  it('stores the source account, the debited amount and the account currency', async () => {
    const { asset, ars } = await setup()
    // Paid in pesos for a USD asset: the debit is in the ACCOUNT's currency.
    const lot = await createInvestmentLot({
      ...base,
      assetId: asset.id,
      source: { accountId: ars.id, amount: 4_000_000_00, expectedCurrency: 'ARS' },
    })
    expect(lot).toMatchObject({ sourceAccountId: ars.id, sourceAmount: 4_000_000_00, sourceCurrency: 'ARS' })
  })

  it('rejects a debit before the account opening date', async () => {
    const { asset, usd } = await setup()
    await expect(
      createInvestmentLot({
        ...base,
        date: '2026-09-30',
        assetId: asset.id,
        source: { accountId: usd.id, amount: 100, expectedCurrency: 'USD' },
      }),
    ).rejects.toThrow(/saldo inicial/)
    expect(await db.investmentLots.count()).toBe(0)
  })

  it('rejects an amount parsed for a currency the account no longer has', async () => {
    const { asset, usd } = await setup()
    await expect(
      createInvestmentLot({ ...base, assetId: asset.id, source: { accountId: usd.id, amount: 100, expectedCurrency: 'ARS' } }),
    ).rejects.toThrow(/cambió/)
  })

  it('editing only the date re-checks the kept source account', async () => {
    const { asset, usd } = await setup()
    const lot = await createInvestmentLot({
      ...base,
      assetId: asset.id,
      source: { accountId: usd.id, amount: 100, expectedCurrency: 'USD' },
    })
    await expect(updateInvestmentLot(lot.id, { date: '2026-09-15' })).rejects.toThrow(/saldo inicial/)
    await updateInvestmentLot(lot.id, { date: '2026-10-15' })
    expect(await getInvestmentLot(lot.id)).toMatchObject({ date: '2026-10-15', sourceAccountId: usd.id, sourceAmount: 100 })
  })

  it('source: null removes it; the account then has no movements left', async () => {
    const { deleteAccount } = await import('./accounts.repo')
    const { asset, usd } = await setup()
    const lot = await createInvestmentLot({
      ...base,
      assetId: asset.id,
      source: { accountId: usd.id, amount: 100, expectedCurrency: 'USD' },
    })
    await expect(deleteAccount(usd.id)).rejects.toThrow(/archivala/)
    await updateInvestmentLot(lot.id, { source: null })
    const updated = await getInvestmentLot(lot.id)
    expect(updated?.sourceAccountId).toBeUndefined()
    expect(updated?.sourceAmount).toBeUndefined()
    await deleteAccount(usd.id)
  })

  it('deleting the lot gives the debit back to the account (it is no longer a movement)', async () => {
    const { listAccountMovementRecords } = await import('./accounts.repo')
    const { asset, usd } = await setup()
    const lot = await createInvestmentLot({
      ...base,
      assetId: asset.id,
      source: { accountId: usd.id, amount: 100, expectedCurrency: 'USD' },
    })
    expect((await listAccountMovementRecords()).investmentLots).toHaveLength(1)
    await deleteInvestmentLot(lot.id)
    expect((await listAccountMovementRecords()).investmentLots).toHaveLength(0)
  })
})

describe('borrar una posición con compras pagadas desde una cuenta', () => {
  afterEach(async () => {
    await db.accounts.clear()
  })

  it('is blocked until each sourced purchase loses its account or is deleted', async () => {
    const { createAccount } = await import('./accounts.repo')
    const { deleteInvestmentHolding } = await import('./investments.repo')
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const usd = await createAccount({ name: 'Caja USD', type: 'bank', currency: 'USD', openingBalance: 0, openingDate: '2026-10-01' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 100_000_000,
      currency: 'USD',
      date: '2026-10-09',
      source: { accountId: usd.id, amount: 100, expectedCurrency: 'USD' },
    })
    const holding = await db.investmentHoldings.where('assetId').equals(asset.id).first()

    await expect(deleteInvestmentHolding(holding!.id)).rejects.toThrow(/cuenta de origen/)
    expect(await db.investmentLots.count()).toBe(1)

    await updateInvestmentLot(lot.id, { source: null })
    await deleteInvestmentHolding(holding!.id)
    expect(await db.investmentHoldings.count()).toBe(0)
  })
})

describe('una compra con cuenta de origen es un movimiento de la cuenta', () => {
  afterEach(async () => {
    await db.accounts.clear()
  })

  it('blocks changing the account currency or moving its opening date past the purchase', async () => {
    const { createAccount, updateAccount } = await import('./accounts.repo')
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const usd = await createAccount({ name: 'Caja USD', type: 'bank', currency: 'USD', openingBalance: 0, openingDate: '2026-10-01' })
    await createInvestmentLot({
      assetId: asset.id,
      quantity: 100_000_000,
      currency: 'USD',
      date: '2026-10-09',
      source: { accountId: usd.id, amount: 100, expectedCurrency: 'USD' },
    })
    const base = { name: 'Caja USD', type: 'bank' as const, openingBalance: 0, notes: undefined }
    await expect(updateAccount(usd.id, { ...base, currency: 'ARS', openingDate: '2026-10-01' })).rejects.toThrow(/moneda/)
    await expect(updateAccount(usd.id, { ...base, currency: 'USD', openingDate: '2026-10-10' })).rejects.toThrow(
      /primer movimiento/,
    )
  })
})
