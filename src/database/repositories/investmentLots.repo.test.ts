import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { minor } from '@/domain/money'
import { createAccount, listAccountsWithBalances } from './accounts.repo'
import { INVESTMENT_CATEGORY_ID } from './categories.repo'
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
    db.transactions.clear(),
    db.postings.clear(),
    db.accounts.clear(),
    db.categories.clear(),
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

describe('createInvestmentLot — cuenta de origen', () => {
  it('does not touch the ledger at all when no accountId is given (regression guard: the default path stays untouched)', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })

    expect(lot.transactionId).toBeUndefined()
    expect(await db.transactions.count()).toBe(0)
  })

  it('debits the account for quantity × costPerUnit and links the transaction to the lot', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(100_000_00) })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 5 * 100_000_000, // 5 units
      costPerUnit: 600_00, // USD 600,00
      currency: 'USD',
      date: '2026-01-01',
      accountId: account.id,
    })

    expect(lot.transactionId).toBeDefined()
    const transaction = await db.transactions.get(lot.transactionId!)
    expect(transaction).toMatchObject({ kind: 'investment', status: 'confirmed' })
    const postings = await db.postings.where('transactionId').equals(lot.transactionId!).toArray()
    expect(postings).toHaveLength(2)
    expect(postings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'account', accountId: account.id, amount: -3_000_00 }),
        expect.objectContaining({ target: 'category', categoryId: INVESTMENT_CATEGORY_ID, amount: 3_000_00 }),
      ]),
    )

    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(100_000_00 - 3_000_00) // 5 * 600,00 = 3.000,00

    const category = await db.categories.get(INVESTMENT_CATEGORY_ID)
    expect(category?.isArchived).toBe(true)
  })

  it('rejects an accountId without costPerUnit', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(0) })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })

    await expect(
      createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, currency: 'USD', date: '2026-01-01', accountId: account.id }),
    ).rejects.toThrow(/costo por unidad/i)
    expect(await db.transactions.count()).toBe(0)
  })

  it('rejects an accountId in a different currency than the asset', async () => {
    const account = await createAccount({ name: 'Cuenta ARS', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })

    await expect(
      createInvestmentLot({
        assetId: asset.id,
        quantity: 100_000_000,
        costPerUnit: 60_000,
        currency: 'USD',
        date: '2026-01-01',
        accountId: account.id,
      }),
    ).rejects.toThrow(/moneda|ARS|USD/i)
    expect(await db.transactions.count()).toBe(0)
  })

  it('skips creating a movement (but still creates the lot) for an explicit zero cost — nothing to deduct', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(50_000_00) })
    const asset = await createInvestmentAsset({ name: 'Regalo', type: 'stock', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 100_000_000,
      costPerUnit: 0,
      currency: 'USD',
      date: '2026-01-01',
      accountId: account.id,
    })

    expect(lot.transactionId).toBeUndefined()
    expect(await db.transactions.count()).toBe(0)
    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(50_000_00)
  })
})

describe('updateInvestmentLot — resincroniza el movimiento vinculado', () => {
  it('updates the linked transaction\'s amount when quantity or costPerUnit changes', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(100_000_00) })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 5 * 100_000_000,
      costPerUnit: 600_00,
      currency: 'USD',
      date: '2026-01-01',
      accountId: account.id,
    })

    await updateInvestmentLot(lot.id, { quantity: 10 * 100_000_000 }) // 10 units now, same cost -> 6.000,00

    const postings = await db.postings.where('transactionId').equals(lot.transactionId!).toArray()
    expect(postings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'account', accountId: account.id, amount: -6_000_00 }),
        expect.objectContaining({ target: 'category', amount: 6_000_00 }),
      ]),
    )
    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(100_000_00 - 6_000_00)
  })

  // Regression: the whole point of linking a transaction is that it never
  // silently drifts from the purchase it describes — leaving it stale
  // after an edit would be no better than the manual double-entry this
  // feature replaces. Verified failing with the pre-fix "never touch it"
  // behavior before restoring the resync.
  it('the linked transaction reflects the new amount, not the one it was created with', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(100_000_00) })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 100_000_000,
      costPerUnit: 600_00,
      currency: 'USD',
      date: '2026-01-01',
      accountId: account.id,
    })

    await updateInvestmentLot(lot.id, { costPerUnit: 700_00 })

    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(100_000_00 - 700_00)
  })

  // Regression (found in review): editing cost down to exactly zero
  // used to resync the linked transaction to two $0 postings instead of
  // mirroring createInvestmentLot's "nothing to deduct" rule — a
  // zero-amount kind:'investment' transaction that could never be
  // edited (no "Editar" for that kind from Movimientos) or cleaned up
  // except by deleting the whole lot. Confirmed failing (leaving the
  // $0 postings behind) before restoring the delete-and-unlink fix.
  it('deletes and unlinks the transaction, restoring the balance, when the new cost is exactly zero', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(100_000_00) })
    const asset = await createInvestmentAsset({ name: 'Regalo', type: 'stock', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 100_000_000,
      costPerUnit: 600_00,
      currency: 'USD',
      date: '2026-01-01',
      accountId: account.id,
    })
    const transactionId = lot.transactionId!

    await updateInvestmentLot(lot.id, { costPerUnit: 0 })

    expect((await getInvestmentLot(lot.id))?.transactionId).toBeUndefined()
    expect(await db.transactions.get(transactionId)).toBeUndefined()
    expect(await db.postings.where('transactionId').equals(transactionId).count()).toBe(0)
    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(100_000_00)
  })

  it('rejects clearing costPerUnit on a lot with a linked transaction', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(100_000_00) })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 100_000_000,
      costPerUnit: 600_00,
      currency: 'USD',
      date: '2026-01-01',
      accountId: account.id,
    })

    await expect(updateInvestmentLot(lot.id, { costPerUnit: null })).rejects.toThrow(/vincula/i)
  })

  it('does not touch the ledger when editing a lot with no linked transaction', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({ assetId: asset.id, quantity: 100_000_000, costPerUnit: 10_000, currency: 'USD', date: '2026-01-01' })

    await updateInvestmentLot(lot.id, { costPerUnit: 20_000 })

    expect(await db.transactions.count()).toBe(0)
  })
})

describe('deleteInvestmentLot — deleteLinkedTransaction', () => {
  it('deletes only the lot by default, leaving the linked transaction and balance intact', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(100_000_00) })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 100_000_000,
      costPerUnit: 600_00,
      currency: 'USD',
      date: '2026-01-01',
      accountId: account.id,
    })

    await deleteInvestmentLot(lot.id)

    expect(await getInvestmentLot(lot.id)).toBeUndefined()
    expect(await db.transactions.get(lot.transactionId!)).toBeDefined()
    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(100_000_00 - 600_00)
  })

  it('deletes the linked transaction too when deleteLinkedTransaction is true, restoring the balance', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'USD', openingBalance: minor(100_000_00) })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    const lot = await createInvestmentLot({
      assetId: asset.id,
      quantity: 100_000_000,
      costPerUnit: 600_00,
      currency: 'USD',
      date: '2026-01-01',
      accountId: account.id,
    })

    await deleteInvestmentLot(lot.id, { deleteLinkedTransaction: true })

    expect(await db.transactions.get(lot.transactionId!)).toBeUndefined()
    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(100_000_00)
  })
})
