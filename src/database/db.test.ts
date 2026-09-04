import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { MonetaDatabase } from './db'

// Regression: this seeds a database at exactly the shape db.ts's own
// version(2) shipped with, then opens it with the real MonetaDatabase
// class (which adds version(3)) — exercising the actual .upgrade() path
// a user with existing local data goes through, not just the resulting
// shape. See ADR "Tracking de inversiones por lote" in docs/DECISIONS.md.
describe('db.version(3) upgrade — legacy holdings get one inherited lot', () => {
  it('creates one InvestmentLot per pre-existing holding, matching its quantity/averageCost', async () => {
    const name = `moneta-test-upgrade-${Date.now()}`
    const legacyDb = new Dexie(name)
    legacyDb.version(1).stores({
      accounts: 'id, name, type, currency, isArchived, order',
      categories: 'id, name, kind, parentId, isArchived, order',
      transactions: 'id, date, kind, status, sourcePlanId, [status+date], [kind+date]',
      postings: 'id, transactionId, [accountId+date], [categoryId+date], date',
      recurringPlans: 'id, isPaused, lastMaterializedDate',
      installmentPlans: 'id, accountId, firstDueDate',
      budgets: 'id, categoryId, [categoryId+startsOn]',
      exchangeRates: 'id, [from+to+date], date',
      settings: 'id',
    })
    legacyDb.version(2).stores({
      savingsHoldings: 'id, currency',
      investmentAssets: 'id, type, symbol',
      investmentHoldings: 'id, assetId',
      assetPrices: 'id, [assetId+date], assetId, date',
    })
    await legacyDb.open()
    await legacyDb.table('investmentAssets').add({
      id: 'asset1',
      name: 'SPY',
      type: 'etf',
      currency: 'USD',
      priceMode: 'manual',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await legacyDb.table('investmentHoldings').add({
      id: 'holding1',
      assetId: 'asset1',
      quantity: 500_000_000,
      averageCost: 60000,
      createdAt: '2026-02-15T12:00:00.000Z',
      updatedAt: '2026-02-15T12:00:00.000Z',
    })
    // A holding with quantity 0 shouldn't exist in practice, but the
    // upgrade filters it out defensively — confirm that here too.
    await legacyDb.table('investmentHoldings').add({
      id: 'holding2',
      assetId: 'asset1',
      quantity: 0,
      createdAt: '2026-02-15T12:00:00.000Z',
      updatedAt: '2026-02-15T12:00:00.000Z',
    })
    legacyDb.close()

    const upgraded = new MonetaDatabase(name)
    try {
      await upgraded.open()
      const lots = await upgraded.investmentLots.toArray()
      expect(lots).toHaveLength(1)
      expect(lots[0]).toMatchObject({
        assetId: 'asset1',
        quantity: 500_000_000,
        costPerUnit: 60000,
        currency: 'USD',
        date: '2026-02-15',
      })
    } finally {
      upgraded.close()
      await Dexie.delete(name)
    }
  })

  it('falls back to ARS for an orphaned holding instead of throwing', async () => {
    const name = `moneta-test-upgrade-orphan-${Date.now()}`
    const legacyDb = new Dexie(name)
    legacyDb.version(1).stores({
      accounts: 'id, name, type, currency, isArchived, order',
      categories: 'id, name, kind, parentId, isArchived, order',
      transactions: 'id, date, kind, status, sourcePlanId, [status+date], [kind+date]',
      postings: 'id, transactionId, [accountId+date], [categoryId+date], date',
      recurringPlans: 'id, isPaused, lastMaterializedDate',
      installmentPlans: 'id, accountId, firstDueDate',
      budgets: 'id, categoryId, [categoryId+startsOn]',
      exchangeRates: 'id, [from+to+date], date',
      settings: 'id',
    })
    legacyDb.version(2).stores({
      savingsHoldings: 'id, currency',
      investmentAssets: 'id, type, symbol',
      investmentHoldings: 'id, assetId',
      assetPrices: 'id, [assetId+date], assetId, date',
    })
    await legacyDb.open()
    // No matching investmentAssets row — shouldn't happen given
    // deleteInvestmentAsset's own guard, but a migration running over
    // real production data must never crash on an inconsistent row.
    await legacyDb.table('investmentHoldings').add({
      id: 'holding1',
      assetId: 'missing-asset',
      quantity: 100,
      createdAt: '2026-02-15T12:00:00.000Z',
      updatedAt: '2026-02-15T12:00:00.000Z',
    })
    legacyDb.close()

    const upgraded = new MonetaDatabase(name)
    try {
      await upgraded.open()
      const lots = await upgraded.investmentLots.toArray()
      expect(lots).toHaveLength(1)
      expect(lots[0]?.currency).toBe('ARS')
    } finally {
      upgraded.close()
      await Dexie.delete(name)
    }
  })
})
