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

const V1_STORES = {
  accounts: 'id, name, type, currency, isArchived, order',
  categories: 'id, name, kind, parentId, isArchived, order',
  transactions: 'id, date, kind, status, sourcePlanId, [status+date], [kind+date]',
  postings: 'id, transactionId, [accountId+date], [categoryId+date], date',
  recurringPlans: 'id, isPaused, lastMaterializedDate',
  installmentPlans: 'id, accountId, firstDueDate',
  budgets: 'id, categoryId, [categoryId+startsOn]',
  exchangeRates: 'id, [from+to+date], date',
  settings: 'id',
}
const V2_STORES = {
  savingsHoldings: 'id, currency',
  investmentAssets: 'id, type, symbol',
  investmentHoldings: 'id, assetId',
  assetPrices: 'id, [assetId+date], assetId, date',
}

// Same technique as above, for Etapa 8 (version 5): a database at exactly
// the shape version(4) shipped with gets `kind: 'expense'` on every
// category, and the brand-new accounts/incomes/accountAdjustments tables.
describe('db.version(5) upgrade — categories get kind, accounts come back', () => {
  it('marks every pre-existing category as an expense category', async () => {
    const name = `moneta-test-upgrade-v5-${Date.now()}`
    const legacyDb = new Dexie(name)
    legacyDb.version(1).stores(V1_STORES)
    legacyDb.version(2).stores(V2_STORES)
    legacyDb.version(3).stores({ investmentLots: 'id, assetId, date' })
    legacyDb.version(4).stores({
      accounts: null,
      postings: null,
      transactions: null,
      categories: 'id, name, parentId, isArchived, order',
      expenses: 'id, date, categoryId, status, sourcePlanId, [status+date]',
    })
    await legacyDb.open()
    await legacyDb.table('categories').add({
      id: 'cat1',
      name: 'Comida',
      order: 0,
      isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    legacyDb.close()

    const upgraded = new MonetaDatabase(name)
    try {
      await upgraded.open()
      expect(await upgraded.categories.get('cat1')).toMatchObject({ kind: 'expense' })
      expect(await upgraded.categories.where('kind').equals('expense').count()).toBe(1)
      expect(await upgraded.accounts.count()).toBe(0)
      expect(await upgraded.incomes.count()).toBe(0)
      expect(await upgraded.accountAdjustments.count()).toBe(0)
    } finally {
      upgraded.close()
      await Dexie.delete(name)
    }
  })

  it('a version(3) database goes through 4 (accounts dropped) and 5 (accounts recreated, empty)', async () => {
    const name = `moneta-test-upgrade-v3-v5-${Date.now()}`
    const legacyDb = new Dexie(name)
    legacyDb.version(1).stores(V1_STORES)
    legacyDb.version(2).stores(V2_STORES)
    legacyDb.version(3).stores({ investmentLots: 'id, assetId, date' })
    await legacyDb.open()
    await legacyDb.table('accounts').add({ id: 'old-account', name: 'Banco', type: 'bank', currency: 'ARS' })
    await legacyDb.table('categories').add({
      id: 'cat-income',
      name: 'Sueldo',
      kind: 'income',
      order: 0,
      isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await legacyDb.table('categories').add({
      id: 'cat-expense',
      name: 'Comida',
      kind: 'expense',
      order: 1,
      isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    legacyDb.close()

    const upgraded = new MonetaDatabase(name)
    try {
      await upgraded.open()
      expect(await upgraded.accounts.count()).toBe(0)
      const categories = await upgraded.categories.toArray()
      expect(categories.map((c) => [c.id, c.kind])).toEqual([['cat-expense', 'expense']])
    } finally {
      upgraded.close()
      await Dexie.delete(name)
    }
  })
})

// Fase 4b: plans that come from the ledger era keep the old template shape
// (kind/accountId/toAccountId) — version(4) never cleaned them. Once
// template.accountId means "debit this account", that dead id would make
// every generated gasto fail.
describe('db.version(9) upgrade — legacy plan templates are cleaned', () => {
  it('drops non-expense recurring plans and strips the ledger fields from the rest', async () => {
    const name = `moneta-test-upgrade-v9-${Date.now()}`
    const legacyDb = new Dexie(name)
    legacyDb.version(1).stores(V1_STORES)
    legacyDb.version(2).stores(V2_STORES)
    legacyDb.version(3).stores({ investmentLots: 'id, assetId, date' })
    await legacyDb.open()
    const now = '2026-01-01T00:00:00.000Z'
    const rule = { freq: 'monthly', interval: 1, startDate: '2026-01-01' }
    await legacyDb.table('recurringPlans').bulkAdd([
      {
        id: 'rent',
        template: { description: 'Alquiler', kind: 'expense', accountId: 'acc-old', categoryId: 'c1', amount: 100, currency: 'ARS' },
        rule,
        isPaused: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'salary',
        template: { description: 'Sueldo', kind: 'income', accountId: 'acc-old', categoryId: 'c2', amount: 100, currency: 'ARS' },
        rule,
        isPaused: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await legacyDb.table('installmentPlans').add({
      id: 'tv',
      description: 'Tele',
      accountId: 'acc-old',
      categoryId: 'c1',
      totalAmount: 100,
      currency: 'ARS',
      count: 1,
      firstDueDate: '2026-01-01',
      purchaseDate: '2026-01-01',
      scheduleCache: [100],
      createdAt: now,
      updatedAt: now,
    })
    legacyDb.close()

    const upgraded = new MonetaDatabase(name)
    try {
      await upgraded.open()
      const plans = await upgraded.recurringPlans.toArray()
      expect(plans.map((p) => p.id)).toEqual(['rent'])
      expect(plans[0]?.template).toEqual({ description: 'Alquiler', categoryId: 'c1', amount: 100, currency: 'ARS' })
      expect(await upgraded.installmentPlans.get('tv')).not.toHaveProperty('accountId')
    } finally {
      upgraded.close()
      await Dexie.delete(name)
    }
  })
})

// Etapa 9, Fase 3: a card plan's later cuotas were dated on the purchase
// day shifted N months (an October-statement cuota of an April 24 purchase
// on September 24). version(11) re-dates them to their statement's last
// purchase day — and their status to match.
describe('db.version(11) upgrade — card cuotas dated on their statement’s close', () => {
  it('re-dates every card cuota after the first, leaves the first and non-card plans alone', async () => {
    // A database at version 10: version 11 changes no table, so its stores
    // are the current ones.
    const reference = new MonetaDatabase(`moneta-test-ref-${Date.now()}`)
    const stores = Object.fromEntries(
      reference.tables.map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(', ')]),
    )
    const name = `moneta-test-upgrade-v11-${Date.now()}`
    const legacyDb = new Dexie(name)
    legacyDb.version(10).stores(stores)
    await legacyDb.open()
    const now = '2026-01-01T00:00:00.000Z'
    await legacyDb.table('creditCards').add({ id: 'visa', name: 'Visa', closingDay: 22, dueDay: 4, isArchived: false, order: 0, createdAt: now, updatedAt: now })
    await legacyDb.table('cardStatements').add({ id: 's1', cardId: 'visa', period: '2026-11', closeDate: '2026-11-19', dueDate: '2026-12-03', createdAt: now, updatedAt: now })
    const plan = { categoryId: 'c', currency: 'ARS', totalAmount: 600, count: 6, scheduleCache: [100, 100, 100, 100, 100, 100], createdAt: now, updatedAt: now }
    await legacyDb.table('installmentPlans').bulkAdd([
      { ...plan, id: 'card-plan', description: 'Equipaje', firstDueDate: '2026-04-24', purchaseDate: '2026-04-24', cardId: 'visa' },
      { ...plan, id: 'loan', description: 'Préstamo', firstDueDate: '2026-09-10', purchaseDate: '2026-09-10' },
    ])
    const cuota = (id: string, sourcePlanId: string, occurrenceIndex: number, date: string, status: string, extra = {}) => ({
      id, sourcePlanId, occurrenceIndex, date, status, amount: 100, currency: 'ARS', categoryId: 'c', description: id, createdAt: now, updatedAt: now, ...extra,
    })
    await legacyDb.table('expenses').bulkAdd([
      cuota('c0', 'card-plan', 0, '2026-04-24', 'confirmed', { cardId: 'visa', statementPeriod: '2026-05' }),
      cuota('c5', 'card-plan', 5, '2026-09-24', 'confirmed', { cardId: 'visa', statementPeriod: '2026-10' }),
      // Old rule: dated Oct 24, already "spent"; its statement closes Nov 19.
      cuota('c6', 'card-plan', 6, '2026-10-24', 'confirmed', { cardId: 'visa', statementPeriod: '2026-11' }),
      cuota('l1', 'loan', 1, '2026-10-10', 'confirmed'),
    ])
    legacyDb.close()

    const upgraded = new MonetaDatabase(name)
    try {
      await upgraded.open()
      const byId = new Map((await upgraded.expenses.toArray()).map((e) => [e.id, e]))
      expect(byId.get('c0')).toMatchObject({ date: '2026-04-24', status: 'confirmed' })
      expect(byId.get('c5')).toMatchObject({ date: '2026-10-22', status: 'confirmed' })
      expect(byId.get('c6')?.date).toBe('2026-11-19')
      expect(byId.get('l1')).toMatchObject({ date: '2026-10-10', status: 'confirmed' })
    } finally {
      upgraded.close()
      await Dexie.delete(name)
    }
  })
})
