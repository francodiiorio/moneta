import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { settingsRepo } from '@/database/repositories'
import { generateId } from '@/lib/ids'
import { buildBackupPayload, exportBackup } from './export'
import { importBackup, PassphraseRequiredError, peekIsEncrypted } from './import'
import { migrateToLatest } from './migrations'

afterEach(async () => {
  await Promise.all([
    db.categories.clear(),
    db.expenses.clear(),
    db.recurringPlans.clear(),
    db.installmentPlans.clear(),
    db.budgets.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
    db.investmentLots.clear(),
    db.accounts.clear(),
    db.incomes.clear(),
    db.accountAdjustments.clear(),
    db.transfers.clear(),
    db.creditCards.clear(),
    db.cardStatements.clear(),
    db.statementPayments.clear(),
  ])
})

async function seedFullDatabase() {
  const now = new Date().toISOString()

  const category = {
    id: generateId(),
    name: 'Comida',
    kind: 'expense' as const,
    order: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.categories.add(category)

  const incomeCategory = {
    id: generateId(),
    name: 'Sueldo',
    kind: 'income' as const,
    order: 1,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.categories.add(incomeCategory)

  const account = {
    id: generateId(),
    name: 'Galicia pesos',
    type: 'bank' as const,
    currency: 'ARS',
    openingBalance: 100_000_00,
    openingDate: '2026-08-01',
    isArchived: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.accounts.add(account)

  await db.incomes.add({
    id: generateId(),
    date: '2026-08-05',
    amount: 900_000_00,
    currency: 'ARS',
    accountId: account.id,
    categoryId: incomeCategory.id,
    description: 'Sueldo agosto',
    createdAt: now,
    updatedAt: now,
  })

  await db.accountAdjustments.add({
    id: generateId(),
    accountId: account.id,
    date: '2026-08-31',
    amount: -1_50,
    currency: 'ARS',
    description: 'Comisión',
    createdAt: now,
    updatedAt: now,
  })

  const usdAccount = {
    id: generateId(),
    name: 'Caja USD',
    type: 'bank' as const,
    currency: 'USD',
    openingBalance: 0,
    openingDate: '2026-08-01',
    isArchived: false,
    order: 1,
    createdAt: now,
    updatedAt: now,
  }
  await db.accounts.add(usdAccount)

  await db.transfers.add({
    id: generateId(),
    date: '2026-08-10',
    fromAccountId: account.id,
    toAccountId: usdAccount.id,
    fromAmount: 125_000_00,
    fromCurrency: 'ARS',
    toAmount: 100_00,
    toCurrency: 'USD',
    description: 'Compra de dólares',
    createdAt: now,
    updatedAt: now,
  })

  const card = {
    id: generateId(),
    name: 'Visa',
    closingDay: 25,
    dueDay: 5,
    isArchived: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.creditCards.add(card)
  await db.cardStatements.add({
    id: generateId(),
    cardId: card.id,
    period: '2026-08',
    closeDate: '2026-08-27',
    dueDate: '2026-09-08',
    createdAt: now,
    updatedAt: now,
  })
  await db.expenses.add({
    id: generateId(),
    date: '2026-08-15',
    amount: 30_000_00,
    currency: 'ARS',
    categoryId: category.id,
    description: 'Zapatillas',
    status: 'confirmed' as const,
    cardId: card.id,
    statementPeriod: '2026-08',
    createdAt: now,
    updatedAt: now,
  })
  // August's statement, paid in full from the peso account.
  await db.statementPayments.add({
    id: generateId(),
    cardId: card.id,
    period: '2026-08',
    currency: 'ARS',
    amount: 30_000_00,
    accountId: account.id,
    debitedAmount: 30_000_00,
    debitedCurrency: 'ARS',
    date: '2026-09-05',
    createdAt: now,
    updatedAt: now,
  })

  const expense = {
    id: generateId(),
    date: '2026-08-23',
    amount: 1500,
    currency: 'ARS',
    categoryId: category.id,
    description: 'Supermercado',
    status: 'confirmed' as const,
    accountId: account.id,
    createdAt: now,
    updatedAt: now,
  }
  await db.expenses.add(expense)

  await db.exchangeRates.add({
    id: generateId(),
    date: '2026-08-01',
    from: 'USD',
    to: 'ARS',
    rate: 1200,
  })

  await db.budgets.add({
    id: generateId(),
    categoryId: category.id,
    currency: 'ARS',
    period: 'monthly' as const,
    amount: 50_000,
    startsOn: '2026-08',
    createdAt: now,
    updatedAt: now,
  })

  await db.recurringPlans.add({
    id: generateId(),
    template: {
      description: 'Alquiler',
      categoryId: category.id,
      amount: 200_000,
      currency: 'ARS',
      accountId: account.id,
    },
    rule: { freq: 'monthly' as const, interval: 1, startDate: '2026-08-01' },
    isPaused: false,
    createdAt: now,
    updatedAt: now,
  })

  await db.installmentPlans.add({
    id: generateId(),
    description: 'Heladera en 3 cuotas',
    categoryId: category.id,
    totalAmount: 300_000,
    currency: 'ARS',
    count: 3,
    firstDueDate: '2026-07-15',
    purchaseDate: '2026-07-15',
    scheduleCache: [100_000, 100_000, 100_000],
    cardId: card.id,
    createdAt: now,
    updatedAt: now,
  })

  const asset = {
    id: generateId(),
    name: 'SPDR S&P 500',
    symbol: 'SPY',
    type: 'etf' as const,
    currency: 'USD',
    priceMode: 'manual' as const,
    createdAt: now,
    updatedAt: now,
  }
  await db.investmentAssets.add(asset)

  await db.investmentHoldings.add({
    id: generateId(),
    assetId: asset.id,
    quantity: 500_000_000, // 5.00000000 shares
    createdAt: now,
    updatedAt: now,
  })

  await db.investmentLots.add({
    id: generateId(),
    assetId: asset.id,
    quantity: 500_000_000,
    costPerUnit: 65_000_00,
    currency: 'USD',
    date: '2026-08-20',
    // Paid from the USD account (Etapa 8, Fase 3) — the round-trip has to
    // carry the source-account fields too.
    sourceAccountId: usdAccount.id,
    sourceAmount: 100_00,
    sourceCurrency: 'USD',
    createdAt: now,
    updatedAt: now,
  })

  await db.assetPrices.add({
    id: generateId(),
    assetId: asset.id,
    price: 65_000_00,
    currency: 'USD',
    date: '2026-08-20',
    capturedAt: now,
    source: 'manual' as const,
  })

  await db.savingsHoldings.add({
    id: generateId(),
    name: 'USD efectivo',
    currency: 'USD',
    amount: 250_000,
    createdAt: now,
    updatedAt: now,
  })

  await db.settings.add({
    id: 'singleton',
    baseCurrency: 'ARS',
    locale: 'es-AR',
    firstDayOfMonth: 1,
    theme: 'system' as const,
    schemaVersion: 1,
  })

  return { category, incomeCategory, expense }
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

async function snapshotAllTables() {
  return {
    categories: sortById(await db.categories.toArray()),
    expenses: sortById(await db.expenses.toArray()),
    recurringPlans: sortById(await db.recurringPlans.toArray()),
    installmentPlans: sortById(await db.installmentPlans.toArray()),
    budgets: sortById(await db.budgets.toArray()),
    exchangeRates: sortById(await db.exchangeRates.toArray()),
    savingsHoldings: sortById(await db.savingsHoldings.toArray()),
    investmentAssets: sortById(await db.investmentAssets.toArray()),
    investmentHoldings: sortById(await db.investmentHoldings.toArray()),
    assetPrices: sortById(await db.assetPrices.toArray()),
    investmentLots: sortById(await db.investmentLots.toArray()),
    accounts: sortById(await db.accounts.toArray()),
    incomes: sortById(await db.incomes.toArray()),
    accountAdjustments: sortById(await db.accountAdjustments.toArray()),
    transfers: sortById(await db.transfers.toArray()),
    creditCards: sortById(await db.creditCards.toArray()),
    cardStatements: sortById(await db.cardStatements.toArray()),
    statementPayments: sortById(await db.statementPayments.toArray()),
    settings: await db.settings.get('singleton'),
  }
}

async function clearAllTables() {
  await Promise.all([
    db.categories.clear(),
    db.expenses.clear(),
    db.recurringPlans.clear(),
    db.installmentPlans.clear(),
    db.budgets.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
    db.investmentLots.clear(),
    db.accounts.clear(),
    db.incomes.clear(),
    db.accountAdjustments.clear(),
    db.transfers.clear(),
    db.creditCards.clear(),
    db.cardStatements.clear(),
    db.statementPayments.clear(),
  ])
}

describe('backup round-trip', () => {
  it('reconstructs an identical database state after export -> wipe -> import', async () => {
    await seedFullDatabase()
    const before = await snapshotAllTables()
    const settingsWithDefaults = await settingsRepo.getSettings()

    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    await clearAllTables()
    expect(await db.categories.count()).toBe(0)

    const result = await importBackup(file)
    expect(result.checksumMatched).toBe(true)

    // importBackup() stamps lastBackupImportedAt after the write completes,
    // via settingsRepo.updateSettings() — which also materializes any
    // still-implicit DEFAULT_SETTINGS fields into the row. Compare against
    // that same merge (computed from the pre-wipe state) rather than the
    // raw pre-export row, so the assertion isn't coupled to what happens to
    // be in DEFAULT_SETTINGS today.
    const after = await snapshotAllTables()
    expect(after.settings?.lastBackupImportedAt).toEqual(expect.any(String))
    expect(after).toEqual({
      ...before,
      settings: { ...settingsWithDefaults, lastBackupImportedAt: after.settings?.lastBackupImportedAt },
    })
  })

  it("never inherits the imported file's own lastBackupExportedAt/lastBackupImportedAt — those are local-device facts", async () => {
    await seedFullDatabase()
    // deviceA: exported a while ago, and that export timestamp is part of
    // what's about to be written to the backup file's settings.
    await settingsRepo.updateSettings({ lastBackupExportedAt: '2020-01-01T00:00:00.000Z' })
    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    await clearAllTables()
    // deviceB: this device has never exported.
    await seedFullDatabase()

    await importBackup(file) // mode: 'replace', the default

    const settings = await db.settings.get('singleton')
    expect(settings?.lastBackupExportedAt).toBeUndefined()
    expect(settings?.lastBackupImportedAt).toEqual(expect.any(String))
  })

  it('rejects a backup with a non-positive expense amount', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    payload.data.expenses[0]!.amount = -9999 // Zod's minorAmount.positive() rejects it at parse time

    const file = new File([JSON.stringify(payload)], 'broken.finance', {
      type: 'application/json',
    })

    const countBefore = await db.expenses.count()
    await expect(importBackup(file)).rejects.toThrow(/El backup no es válido/)
    expect(await db.expenses.count()).toBe(countBefore) // nothing was written
  })

  it('rejects a backup with an "auto" priceMode investment asset that is not crypto', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    payload.data.investmentAssets[0]!.priceMode = 'auto' // seeded asset is an 'etf', not 'crypto'

    const file = new File([JSON.stringify(payload)], 'broken.finance', { type: 'application/json' })

    const countBefore = await db.categories.count()
    await expect(importBackup(file)).rejects.toThrow(/El backup no es válido/)
    expect(await db.categories.count()).toBe(countBefore) // nothing was written
  })

  it('rejects a backup from a future format version', () => {
    expect(() => migrateToLatest({ version: 99 })).toThrow(/versión más nueva/)
  })

  it('rejects a file that is not valid JSON', async () => {
    const file = new File(['not json'], 'broken.finance')
    await expect(importBackup(file)).rejects.toThrow(/JSON válido/)
  })
})

describe('backup round-trip — encrypted', () => {
  it('reconstructs an identical database state after export(passphrase) -> wipe -> import(passphrase)', async () => {
    await seedFullDatabase()
    const before = await snapshotAllTables()
    const settingsWithDefaults = await settingsRepo.getSettings()

    const exported = await exportBackup('correcto-caballo-batería-grapa')
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    // An encrypted export is not readable JSON of the underlying data —
    // the whole point of this feature.
    const rawText = await exported.blob.text()
    expect(rawText).not.toContain('Comida')
    expect(rawText).not.toContain('Supermercado')

    expect(await peekIsEncrypted(file)).toBe(true)

    await clearAllTables()

    const result = await importBackup(file, { passphrase: 'correcto-caballo-batería-grapa' })
    expect(result.checksumMatched).toBe(true)

    // importBackup() stamps lastBackupImportedAt after the write completes,
    // via settingsRepo.updateSettings() — which also materializes any
    // still-implicit DEFAULT_SETTINGS fields into the row. Compare against
    // that same merge (computed from the pre-wipe state) rather than the
    // raw pre-export row, so the assertion isn't coupled to what happens to
    // be in DEFAULT_SETTINGS today.
    const after = await snapshotAllTables()
    expect(after.settings?.lastBackupImportedAt).toEqual(expect.any(String))
    expect(after).toEqual({
      ...before,
      settings: { ...settingsWithDefaults, lastBackupImportedAt: after.settings?.lastBackupImportedAt },
    })
  })

  it('requires a passphrase for an encrypted file, and does not write anything without one', async () => {
    await seedFullDatabase()
    const exported = await exportBackup('contraseña')
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    const countBefore = await db.expenses.count()
    await expect(importBackup(file)).rejects.toThrow(PassphraseRequiredError)
    expect(await db.expenses.count()).toBe(countBefore)
  })

  it('rejects the wrong passphrase, and does not write anything', async () => {
    await seedFullDatabase()
    const exported = await exportBackup('contraseña-correcta')
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    const countBefore = await db.expenses.count()
    await expect(importBackup(file, { passphrase: 'contraseña-incorrecta' })).rejects.toThrow(/Contraseña incorrecta/)
    expect(await db.expenses.count()).toBe(countBefore)
  })

  it('peekIsEncrypted returns false for a plaintext backup', async () => {
    const exported = await exportBackup() // no passphrase
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })
    expect(await peekIsEncrypted(file)).toBe(false)
  })

  it('peekIsEncrypted returns false (not a throw) for a file that is not valid JSON', async () => {
    const file = new File(['not json'], 'broken.finance')
    expect(await peekIsEncrypted(file)).toBe(false)
  })
})

describe('backup round-trip — merge', () => {
  it('combines a disjoint dataset from a backup with what is already local, without touching either', async () => {
    const deviceA = await seedFullDatabase()
    const exportedA = await exportBackup()
    const file = new File([exportedA.blob], exportedA.filename, { type: 'application/json' })

    await clearAllTables()

    // A second, independent dataset — seedFullDatabase() mints fresh ids
    // every call, so this never collides with deviceA's.
    const deviceB = await seedFullDatabase()

    const result = await importBackup(file, { mode: 'merge' })
    expect(result.checksumMatched).toBe(true)
    expect(result.merged).toEqual({
      categories: { added: 2, skipped: 0 },
      expenses: { added: 2, skipped: 0 },
      recurringPlans: { added: 1, skipped: 0 },
      installmentPlans: { added: 1, skipped: 0 },
      budgets: { added: 1, skipped: 0 },
      exchangeRates: { added: 1, skipped: 0 },
      savingsHoldings: { added: 1, skipped: 0 },
      investmentAssets: { added: 1, skipped: 0 },
      investmentHoldings: { added: 1, skipped: 0 },
      assetPrices: { added: 1, skipped: 0 },
      investmentLots: { added: 1, skipped: 0 },
      accounts: { added: 2, skipped: 0 },
      incomes: { added: 1, skipped: 0 },
      accountAdjustments: { added: 1, skipped: 0 },
      transfers: { added: 1, skipped: 0 },
      creditCards: { added: 1, skipped: 0 },
      cardStatements: { added: 1, skipped: 0 },
      statementPayments: { added: 1, skipped: 0 },
    })

    const categoryIds = (await db.categories.toArray()).map((c) => c.id).sort()
    expect(categoryIds).toEqual(
      [deviceA.category.id, deviceA.incomeCategory.id, deviceB.category.id, deviceB.incomeCategory.id].sort(),
    )
    const expenseIds = (await db.expenses.toArray()).map((e) => e.id)
    expect(expenseIds).toHaveLength(4) // a debit gasto and a card gasto from each device
    expect(expenseIds).toEqual(expect.arrayContaining([deviceA.expense.id, deviceB.expense.id]))
    // Local settings (from deviceB's seed) were never touched by the merge.
    expect((await db.settings.get('singleton'))?.baseCurrency).toBe('ARS')
  })

  it('merging the same backup twice in a row is idempotent (no duplicates the second time)', async () => {
    await seedFullDatabase()
    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    const first = await importBackup(file, { mode: 'merge' })
    expect(first.merged?.categories).toEqual({ added: 0, skipped: 2 }) // same device, ids already exist

    const countBefore = await db.expenses.count()
    const second = await importBackup(file, { mode: 'merge' })
    expect(second.merged).toEqual({
      categories: { added: 0, skipped: 2 },
      expenses: { added: 0, skipped: 2 },
      recurringPlans: { added: 0, skipped: 1 },
      installmentPlans: { added: 0, skipped: 1 },
      budgets: { added: 0, skipped: 1 },
      exchangeRates: { added: 0, skipped: 1 },
      savingsHoldings: { added: 0, skipped: 1 },
      investmentAssets: { added: 0, skipped: 1 },
      investmentHoldings: { added: 0, skipped: 1 },
      assetPrices: { added: 0, skipped: 1 },
      investmentLots: { added: 0, skipped: 1 },
      accounts: { added: 0, skipped: 2 },
      incomes: { added: 0, skipped: 1 },
      accountAdjustments: { added: 0, skipped: 1 },
      transfers: { added: 0, skipped: 1 },
      creditCards: { added: 0, skipped: 1 },
      cardStatements: { added: 0, skipped: 1 },
      statementPayments: { added: 0, skipped: 1 },
    })
    expect(await db.expenses.count()).toBe(countBefore)
  })
})

describe('migration — v1 through v4', () => {
  it('migrates a v1 backup (no patrimonio tables, no gastos) to v4 empty across the board', () => {
    const v1Payload = {
      format: 'moneta-backup' as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      app: { name: 'moneta', version: '0.0.0' },
      checksum: 'irrelevant-for-this-test',
      data: {
        accounts: [],
        categories: [],
        transactions: [],
        postings: [],
        recurringPlans: [],
        installmentPlans: [],
        budgets: [],
        exchangeRates: [],
      },
    }

    const migrated = migrateToLatest(v1Payload)

    expect(migrated.categories).toEqual([])
    expect(migrated.expenses).toEqual([])
    expect(migrated.savingsHoldings).toEqual([])
    expect(migrated.investmentAssets).toEqual([])
    expect(migrated.investmentHoldings).toEqual([])
    expect(migrated.assetPrices).toEqual([])
    expect(migrated.investmentLots).toEqual([])
  })

  it('importing a v1 .finance file (via importBackup) lands with everything empty', async () => {
    const v1Payload = {
      format: 'moneta-backup' as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      app: { name: 'moneta', version: '0.0.0' },
      checksum: 'irrelevant-for-this-test',
      data: {
        accounts: [],
        categories: [],
        transactions: [],
        postings: [],
        recurringPlans: [],
        installmentPlans: [],
        budgets: [],
        exchangeRates: [],
      },
    }
    const file = new File([JSON.stringify(v1Payload)], 'old.finance', { type: 'application/json' })

    await importBackup(file)

    expect(await db.expenses.count()).toBe(0)
    expect(await db.savingsHoldings.count()).toBe(0)
    expect(await db.investmentAssets.count()).toBe(0)
    expect(await db.investmentHoldings.count()).toBe(0)
    expect(await db.assetPrices.count()).toBe(0)
    expect(await db.investmentLots.count()).toBe(0)
  })

  function v2PayloadWithExpenseAndHolding(holding: { quantity: number; averageCost?: number }) {
    const account = {
      id: 'acc1',
      name: 'Banco',
      type: 'bank' as const,
      currency: 'ARS',
      openingBalance: 0,
      isArchived: false,
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const category = {
      id: 'cat1',
      name: 'Comida',
      kind: 'expense' as const,
      order: 0,
      isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const transaction = {
      id: 'tx1',
      date: '2026-08-23',
      kind: 'expense' as const,
      description: 'Super',
      status: 'confirmed' as const,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    }
    return {
      format: 'moneta-backup' as const,
      version: 2 as const,
      exportedAt: new Date().toISOString(),
      app: { name: 'moneta', version: '0.0.0' },
      checksum: 'irrelevant-for-this-test',
      data: {
        accounts: [account],
        categories: [category],
        transactions: [transaction],
        postings: [
          { id: 'p1', transactionId: 'tx1', target: 'account' as const, accountId: 'acc1', amount: -1500, currency: 'ARS', date: '2026-08-23' },
          { id: 'p2', transactionId: 'tx1', target: 'category' as const, categoryId: 'cat1', amount: 1500, currency: 'ARS', date: '2026-08-23' },
        ],
        recurringPlans: [],
        installmentPlans: [],
        budgets: [],
        exchangeRates: [],
        savingsHoldings: [],
        investmentAssets: [
          {
            id: 'asset1',
            name: 'SPY',
            type: 'etf' as const,
            currency: 'USD',
            priceMode: 'manual' as const,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        investmentHoldings: [
          {
            id: 'holding1',
            assetId: 'asset1',
            createdAt: '2026-02-15T12:00:00.000Z',
            updatedAt: '2026-02-15T12:00:00.000Z',
            ...holding,
          },
        ],
        assetPrices: [],
      },
    }
  }

  it('grandfathers a pre-existing holding into one inherited lot, and turns the expense transaction into an Expense', () => {
    const migrated = migrateToLatest(v2PayloadWithExpenseAndHolding({ quantity: 500_000_000, averageCost: 60000 }))

    expect(migrated.investmentLots).toHaveLength(1)
    expect(migrated.investmentLots[0]).toMatchObject({
      assetId: 'asset1',
      quantity: 500_000_000,
      costPerUnit: 60000,
      currency: 'USD',
      date: '2026-02-15',
    })
    expect(migrated.expenses).toHaveLength(1)
    expect(migrated.expenses[0]).toMatchObject({ id: 'tx1', amount: 1500, currency: 'ARS', categoryId: 'cat1' })
  })

  it('inherits a lot with no cost when the holding never had one', () => {
    const migrated = migrateToLatest(v2PayloadWithExpenseAndHolding({ quantity: 500_000_000 }))

    expect(migrated.investmentLots).toHaveLength(1)
    expect(migrated.investmentLots[0]?.costPerUnit).toBeUndefined()
  })

  it('creates no lot for a zero-quantity holding', () => {
    const migrated = migrateToLatest(v2PayloadWithExpenseAndHolding({ quantity: 0 }))

    expect(migrated.investmentLots).toEqual([])
  })

  it('importing a v2 .finance file with a holding lands with its inherited lot and expense in Dexie', async () => {
    const payload = v2PayloadWithExpenseAndHolding({ quantity: 500_000_000, averageCost: 60000 })
    const file = new File([JSON.stringify(payload)], 'old-v2.finance', { type: 'application/json' })

    await importBackup(file)

    const lots = await db.investmentLots.toArray()
    expect(lots).toHaveLength(1)
    expect(lots[0]).toMatchObject({ assetId: 'asset1', quantity: 500_000_000, costPerUnit: 60000 })

    const expenses = await db.expenses.toArray()
    expect(expenses).toHaveLength(1)
    expect(expenses[0]).toMatchObject({ amount: 1500, currency: 'ARS' })
  })
})

function v4Payload() {
  const now = '2026-09-10T12:00:00.000Z'
  return {
    format: 'moneta-backup' as const,
    version: 4 as const,
    exportedAt: now,
    app: { name: 'moneta', version: '0.0.0' },
    checksum: 'irrelevant-for-this-test',
    data: {
      // A real v4 file: categories have no `kind`.
      categories: [{ id: 'cat1', name: 'Comida', order: 0, isArchived: false, createdAt: now, updatedAt: now }],
      expenses: [
        {
          id: 'e1',
          date: '2026-09-01',
          amount: 1500,
          currency: 'ARS',
          categoryId: 'cat1',
          description: 'Super',
          status: 'confirmed' as const,
          createdAt: now,
          updatedAt: now,
        },
      ],
      recurringPlans: [],
      installmentPlans: [],
      budgets: [],
      exchangeRates: [],
      savingsHoldings: [],
      investmentAssets: [],
      investmentHoldings: [],
      assetPrices: [],
      investmentLots: [],
    },
  }
}

describe('migration — v4 to v5 (Etapa 8: cuentas e ingresos)', () => {
  it('a v4 file still validates as it did (categories without kind) and every category becomes a gasto category', () => {
    const migrated = migrateToLatest(v4Payload())

    expect(migrated.categories).toEqual([expect.objectContaining({ id: 'cat1', kind: 'expense' })])
    expect(migrated.expenses).toHaveLength(1)
    expect(migrated.expenses[0]?.accountId).toBeUndefined()
    expect(migrated.accounts).toEqual([])
    expect(migrated.incomes).toEqual([])
    expect(migrated.accountAdjustments).toEqual([])
    expect(migrated.transfers).toEqual([])
  })

  it('importing a v4 .finance file lands its categories with kind expense in Dexie', async () => {
    const file = new File([JSON.stringify(v4Payload())], 'old-v4.finance', { type: 'application/json' })

    await importBackup(file)

    expect(await db.categories.get('cat1')).toMatchObject({ kind: 'expense' })
    expect(await db.expenses.count()).toBe(1)
  })

  it('exports as version 10', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    expect(payload.version).toBe(10)
    expect(payload.data.accounts).toHaveLength(2)
    expect(payload.data.incomes).toHaveLength(1)
    expect(payload.data.accountAdjustments).toHaveLength(1)
    expect(payload.data.transfers).toHaveLength(1)
    expect(payload.data.investmentLots[0]?.sourceAccountId).toBeDefined()
  })
})

describe('import validation — cuentas e ingresos', () => {
  async function exportedPayload() {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    return payload
  }

  async function importPayload(payload: unknown) {
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    return importBackup(file)
  }

  it('rejects an ingreso pointing at an account that is not in the file, without touching the database', async () => {
    const payload = await exportedPayload()
    payload.data.incomes[0]!.accountId = 'missing-account'
    await expect(importPayload(payload)).rejects.toThrow(/no existe/)
    expect(await db.categories.count()).toBe(0)
  })

  it('rejects an ingreso that uses a gasto category', async () => {
    const payload = await exportedPayload()
    const expenseCategory = payload.data.categories.find((c) => c.kind === 'expense')!
    payload.data.incomes[0]!.categoryId = expenseCategory.id
    await expect(importPayload(payload)).rejects.toThrow(/no es de ingreso/)
  })

  it('rejects a gasto that uses an ingreso category', async () => {
    const payload = await exportedPayload()
    const incomeCategory = payload.data.categories.find((c) => c.kind === 'income')!
    payload.data.expenses.find((e) => e.description === 'Supermercado')!.categoryId = incomeCategory.id
    await expect(importPayload(payload)).rejects.toThrow(/categoría de ingreso/)
  })

  it('rejects a debit gasto dated before its account opening date', async () => {
    const payload = await exportedPayload()
    payload.data.expenses.find((e) => e.description === 'Supermercado')!.date = '2026-07-31'
    await expect(importPayload(payload)).rejects.toThrow(/saldo inicial/)
  })

  it('rejects an ingreso in a currency other than its account', async () => {
    const payload = await exportedPayload()
    payload.data.incomes[0]!.currency = 'USD'
    await expect(importPayload(payload)).rejects.toThrow(/es en ARS/)
  })
})

describe('backup — hallazgos de la revisión de la Fase 1', () => {
  it('a v4 file with a correct checksum still imports as checksumMatched (hashed before migrating)', async () => {
    const { computeChecksum } = await import('./checksum')
    const payload = v4Payload()
    payload.checksum = await computeChecksum(payload.data)
    const file = new File([JSON.stringify(payload)], 'v4.finance', { type: 'application/json' })
    const result = await importBackup(file)
    expect(result.checksumMatched).toBe(true)
  })

  it('a stray accountId in a v4 expense is stripped, exactly as before v5 existed', () => {
    const payload = v4Payload()
    const expense = { ...payload.data.expenses[0]!, accountId: 'ghost' }
    const migrated = migrateToLatest({ ...payload, data: { ...payload.data, expenses: [expense] } })
    expect(migrated.expenses[0]?.accountId).toBeUndefined()
  })

  it('merge rolls back entirely when an incoming ingreso does not fit the LOCAL copy of its account', async () => {
    const seeded = await seedFullDatabase()
    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    // Same account id on this device, but since switched to USD (allowed
    // locally while it had no movements here).
    const accountId = (await db.accounts.toArray()).find((a) => a.name === 'Galicia pesos')!.id
    await clearAllTables()
    const now = new Date().toISOString()
    await db.accounts.add({
      id: accountId,
      name: 'Galicia (ahora en dólares)',
      type: 'bank',
      currency: 'USD',
      openingBalance: 0,
      openingDate: '2026-08-01',
      isArchived: false,
      order: 0,
      createdAt: now,
      updatedAt: now,
    })

    await expect(importBackup(file, { mode: 'merge' })).rejects.toThrow(/es en USD/)
    // Nothing from the file landed — Dexie rolled the whole merge back.
    expect(await db.incomes.count()).toBe(0)
    expect(await db.categories.get(seeded.category.id)).toBeUndefined()
    expect(await db.accounts.count()).toBe(1)
  })
})

describe('transferencias en el backup (Fase 2)', () => {
  it('a v5 file migrates to v6 with no transfers', () => {
    const v5 = {
      ...v4Payload(),
      version: 5 as const,
      data: {
        ...v4Payload().data,
        categories: v4Payload().data.categories.map((c) => ({ ...c, kind: 'expense' as const })),
        accounts: [],
        incomes: [],
        accountAdjustments: [],
      },
    }
    const migrated = migrateToLatest(v5)
    expect(migrated.transfers).toEqual([])
    expect(migrated.categories[0]?.kind).toBe('expense')
  })

  it('rejects a transfer from an account to itself, without touching the database', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    const transfer = payload.data.transfers[0]!
    transfer.toAccountId = transfer.fromAccountId
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/distintas/)
    expect(await db.accounts.count()).toBe(0)
  })
})

describe('compras de inversión con cuenta de origen en el backup (Fase 3)', () => {
  it('a v6 file migrates to v7 with every lot unchanged (no source account)', () => {
    const v6 = {
      ...v4Payload(),
      version: 6 as const,
      data: {
        ...v4Payload().data,
        categories: v4Payload().data.categories.map((c) => ({ ...c, kind: 'expense' as const })),
        accounts: [],
        incomes: [],
        accountAdjustments: [],
        transfers: [],
      },
    }
    expect(migrateToLatest(v6).investmentLots).toEqual([])
  })

  it('rejects a lot paid from an account that does not exist in the file', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    payload.data.investmentLots[0]!.sourceAccountId = 'ghost'
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/Compra de inversión.*no existe/)
  })

  it('rejects a lot with a source account but no amount (fields go together)', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    delete payload.data.investmentLots[0]!.sourceAmount
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/van juntos/)
  })
})

describe('revisión de la Fase 3 — backups', () => {
  it('a real v6 lot migrates unchanged, and a stray sourceAccountId in it is stripped (never debits)', () => {
    const now = '2026-09-10T12:00:00.000Z'
    const v6 = {
      ...v4Payload(),
      version: 6 as const,
      data: {
        ...v4Payload().data,
        categories: v4Payload().data.categories.map((c) => ({ ...c, kind: 'expense' as const })),
        investmentAssets: [
          { id: 'spy', name: 'SPY', type: 'etf' as const, currency: 'USD', priceMode: 'manual' as const, createdAt: now, updatedAt: now },
        ],
        investmentHoldings: [{ id: 'h1', assetId: 'spy', quantity: 100_000_000, createdAt: now, updatedAt: now }],
        investmentLots: [
          { id: 'l1', assetId: 'spy', quantity: 100_000_000, currency: 'USD', date: '2026-09-01', sourceAccountId: 'ghost', createdAt: now, updatedAt: now },
        ],
        accounts: [],
        incomes: [],
        accountAdjustments: [],
        transfers: [],
      },
    }
    const [lot] = migrateToLatest(v6).investmentLots
    expect(lot).toMatchObject({ id: 'l1', quantity: 100_000_000, date: '2026-09-01' })
    expect(lot?.sourceAccountId).toBeUndefined()
  })

  it('merge rolls back when an incoming sourced purchase does not fit the LOCAL copy of its account', async () => {
    await seedFullDatabase()
    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })
    const usdId = (await db.accounts.toArray()).find((a) => a.name === 'Caja USD')!.id

    await clearAllTables()
    const now = new Date().toISOString()
    // Same id locally, but in pesos: the incoming USD debit can't land here.
    await db.accounts.add({
      id: usdId,
      name: 'Caja (ahora en pesos)',
      type: 'bank',
      currency: 'ARS',
      openingBalance: 0,
      openingDate: '2026-01-01',
      isArchived: false,
      order: 0,
      createdAt: now,
      updatedAt: now,
    })
    await expect(importBackup(file, { mode: 'merge' })).rejects.toThrow(/es en ARS/)
    expect(await db.investmentLots.count()).toBe(0)
  })
})

describe('tarjetas en el backup (Fase 4)', () => {
  it('a v7 file migrates to v8 with no cards and no gasto on a card', () => {
    const v7 = {
      ...v4Payload(),
      version: 7 as const,
      data: {
        ...v4Payload().data,
        categories: v4Payload().data.categories.map((c) => ({ ...c, kind: 'expense' as const })),
        accounts: [],
        incomes: [],
        accountAdjustments: [],
        transfers: [],
      },
    }
    const migrated = migrateToLatest(v7)
    expect(migrated.creditCards).toEqual([])
    expect(migrated.cardStatements).toEqual([])
    expect(migrated.expenses[0]?.cardId).toBeUndefined()
  })

  it('rejects a gasto on a card that is not in the file', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    payload.data.expenses.find((e) => e.description === 'Zapatillas')!.cardId = 'ghost'
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/tarjeta ghost no existe/)
  })

  it('merge keeps the local corrected dates of a period over an incoming row with another id', async () => {
    await seedFullDatabase()
    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })
    const [statement] = await db.cardStatements.toArray()
    await db.cardStatements.update(statement!.id, { closeDate: '2026-08-26' })
    // Same card+period locally under a different id: the local row wins.
    await db.cardStatements.delete(statement!.id)
    await db.cardStatements.add({ ...statement!, id: 'local-row', closeDate: '2026-08-26' })

    const result = await importBackup(file, { mode: 'merge' })
    expect(result.merged?.cardStatements).toEqual({ added: 0, skipped: 1 })
    expect(await db.cardStatements.toArray()).toEqual([expect.objectContaining({ id: 'local-row', closeDate: '2026-08-26' })])
  })
})

describe('revisión de la Fase 4a — backups', () => {
  it('rejects corrected dates out of order (a mistyped year)', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    payload.data.cardStatements[0]!.closeDate = '2025-08-27'
    payload.data.cardStatements[0]!.dueDate = '2025-09-08'
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/ese mes o en el siguiente/)
  })

  it('rejects a gasto billed in a statement that closed before its date', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    payload.data.expenses.find((e) => e.description === 'Zapatillas')!.date = '2026-08-28'
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/cerró antes/)
  })

  it('merging corrected dates for a local card re-places its automatic gastos', async () => {
    await seedFullDatabase()
    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })
    const [card] = await db.creditCards.toArray()
    // Locally: no corrected dates, nothing paid, and a gasto on Aug 26
    // (after the default 25th close) automatically in September.
    await db.cardStatements.clear()
    await db.statementPayments.clear()
    const zapatillas = (await db.expenses.toArray()).find((e) => e.description === 'Zapatillas')!
    await db.expenses.update(zapatillas.id, { date: '2026-08-26', statementPeriod: '2026-09' })

    // The file corrects August to close on the 27th: the gasto belongs there.
    await importBackup(file, { mode: 'merge' })
    expect(await db.cardStatements.where('cardId').equals(card!.id).count()).toBe(1)
    expect((await db.expenses.get(zapatillas.id))?.statementPeriod).toBe('2026-08')
  })
})

describe('tarjeta con compras del día de cierre al resumen siguiente', () => {
  it('the option survives an export and import', async () => {
    await seedFullDatabase()
    const [card] = await db.creditCards.toArray()
    await db.creditCards.update(card!.id, { closingDayToNext: true })
    const exported = await exportBackup()
    await clearAllTables()
    await importBackup(new File([exported.blob], exported.filename, { type: 'application/json' }))
    expect((await db.creditCards.get(card!.id))?.closingDayToNext).toBe(true)
  })
})

describe('planes con medio de pago en el backup (Fase 4b)', () => {
  it('rejects a recurring plan paid from an account that is not in the file', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    payload.data.recurringPlans[0]!.template.accountId = 'ghost'
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/cuenta ghost no existe/)
  })
})

describe('planes de antes de la Etapa 7 en el backup (Fase 4b)', () => {
  it('a v8 file with a ledger-era template.accountId imports, dropping that dead id', () => {
    const now = '2026-09-10T12:00:00.000Z'
    const v8 = {
      ...v4Payload(),
      version: 8 as const,
      data: {
        ...v4Payload().data,
        categories: v4Payload().data.categories.map((c) => ({ ...c, kind: 'expense' as const })),
        recurringPlans: [
          {
            id: 'rent',
            template: { description: 'Alquiler', categoryId: 'cat1', amount: 100, currency: 'ARS', accountId: 'acc-ledger' },
            rule: { freq: 'monthly' as const, interval: 1, startDate: '2026-01-01' },
            isPaused: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        accounts: [],
        incomes: [],
        accountAdjustments: [],
        transfers: [],
        creditCards: [],
        cardStatements: [],
      },
    }
    const migrated = migrateToLatest(v8)
    expect(migrated.recurringPlans[0]?.template).toEqual({ description: 'Alquiler', categoryId: 'cat1', amount: 100, currency: 'ARS' })
  })
})

describe('revisión de la Fase 4b — backups', () => {
  it('rejects a debit recurring plan whose next gasto falls before its account’s opening date', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    payload.data.recurringPlans[0]!.rule.startDate = '2026-01-01'
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/saldo inicial/)
  })

  it('rejects a card installment plan whose first cuota is not the purchase date', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    payload.data.installmentPlans[0]!.firstDueDate = '2026-09-01'
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/primera cuota es la fecha de compra/)
  })
})

describe('pagos de resúmenes en el backup (Fase 5)', () => {
  it('a v9 file migrates to v10 with every statement unpaid', () => {
    const v9 = {
      ...v4Payload(),
      version: 9 as const,
      data: {
        ...v4Payload().data,
        categories: v4Payload().data.categories.map((c) => ({ ...c, kind: 'expense' as const })),
        accounts: [],
        incomes: [],
        accountAdjustments: [],
        transfers: [],
        creditCards: [],
        cardStatements: [],
      },
    }
    expect(migrateToLatest(v9).statementPayments).toEqual([])
  })

  it('rejects a payment whose card, account or currency key is wrong', async () => {
    for (const [tamper, message] of [
      [(p: Awaited<ReturnType<typeof buildBackupPayload>>) => (p.data.statementPayments[0]!.cardId = 'ghost'), /tarjeta ghost no existe/],
      [(p: Awaited<ReturnType<typeof buildBackupPayload>>) => (p.data.statementPayments[0]!.accountId = 'ghost'), /cuenta ghost no existe/],
      [
        (p: Awaited<ReturnType<typeof buildBackupPayload>>) =>
          p.data.statementPayments.push({ ...p.data.statementPayments[0]!, id: 'twin' }),
        /ya tiene un pago en ARS/,
      ],
    ] as const) {
      await seedFullDatabase()
      const payload = await buildBackupPayload()
      await clearAllTables()
      tamper(payload)
      const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
      await expect(importBackup(file)).rejects.toThrow(message)
    }
  })

  it('merge: a statement paid locally keeps its payment — the file’s, even under another id, is skipped', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    const [local] = await db.statementPayments.toArray()
    payload.data.statementPayments = [{ ...local!, id: 'other-device', date: '2026-09-06' }]
    const file = new File([JSON.stringify(payload)], 'other.finance', { type: 'application/json' })
    const result = await importBackup(file, { mode: 'merge' })
    expect(result.merged?.statementPayments).toEqual({ added: 0, skipped: 1 })
    expect(await db.statementPayments.toArray()).toEqual([local])
  })

  it('merge: a new payment must fit the LOCAL account (its currency changed here)', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    const [local] = await db.statementPayments.toArray()
    await db.statementPayments.clear()
    await db.accounts.update(local!.accountId, { currency: 'USD' })
    const file = new File([JSON.stringify(payload)], 'other.finance', { type: 'application/json' })
    await expect(importBackup(file, { mode: 'merge' })).rejects.toThrow(/en tu base local/)
  })

  it('merge: corrected dates from the file never move the close of a statement paid here', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await db.cardStatements.clear()
    const file = new File([JSON.stringify(payload)], 'other.finance', { type: 'application/json' })
    const result = await importBackup(file, { mode: 'merge' })
    expect(result.merged?.cardStatements).toEqual({ added: 0, skipped: 1 })
  })

  it('rejects a same-currency payment that debited a different amount', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    await clearAllTables()
    payload.data.statementPayments[0]!.debitedAmount = 1
    const file = new File([JSON.stringify(payload)], 'tampered.finance', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/misma moneda/)
  })
})
