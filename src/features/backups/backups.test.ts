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
  ])
})

async function seedFullDatabase() {
  const now = new Date().toISOString()

  const category = {
    id: generateId(),
    name: 'Comida',
    order: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.categories.add(category)

  const expense = {
    id: generateId(),
    date: '2026-08-23',
    amount: 1500,
    currency: 'ARS',
    categoryId: category.id,
    description: 'Supermercado',
    status: 'confirmed' as const,
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
    },
    rule: { freq: 'monthly' as const, interval: 1, startDate: '2026-01-01' },
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
    firstDueDate: '2026-08-01',
    purchaseDate: '2026-07-15',
    scheduleCache: [100_000, 100_000, 100_000],
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
    date: '2026-07-20',
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

  return { category, expense }
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
      categories: { added: 1, skipped: 0 },
      expenses: { added: 1, skipped: 0 },
      recurringPlans: { added: 1, skipped: 0 },
      installmentPlans: { added: 1, skipped: 0 },
      budgets: { added: 1, skipped: 0 },
      exchangeRates: { added: 1, skipped: 0 },
      savingsHoldings: { added: 1, skipped: 0 },
      investmentAssets: { added: 1, skipped: 0 },
      investmentHoldings: { added: 1, skipped: 0 },
      assetPrices: { added: 1, skipped: 0 },
      investmentLots: { added: 1, skipped: 0 },
    })

    const categoryIds = (await db.categories.toArray()).map((c) => c.id).sort()
    expect(categoryIds).toEqual([deviceA.category.id, deviceB.category.id].sort())
    const expenseIds = (await db.expenses.toArray()).map((e) => e.id).sort()
    expect(expenseIds).toEqual([deviceA.expense.id, deviceB.expense.id].sort())
    // Local settings (from deviceB's seed) were never touched by the merge.
    expect((await db.settings.get('singleton'))?.baseCurrency).toBe('ARS')
  })

  it('merging the same backup twice in a row is idempotent (no duplicates the second time)', async () => {
    await seedFullDatabase()
    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    const first = await importBackup(file, { mode: 'merge' })
    expect(first.merged?.categories).toEqual({ added: 0, skipped: 1 }) // same device, ids already exist

    const countBefore = await db.expenses.count()
    const second = await importBackup(file, { mode: 'merge' })
    expect(second.merged).toEqual({
      categories: { added: 0, skipped: 1 },
      expenses: { added: 0, skipped: 1 },
      recurringPlans: { added: 0, skipped: 1 },
      installmentPlans: { added: 0, skipped: 1 },
      budgets: { added: 0, skipped: 1 },
      exchangeRates: { added: 0, skipped: 1 },
      savingsHoldings: { added: 0, skipped: 1 },
      investmentAssets: { added: 0, skipped: 1 },
      investmentHoldings: { added: 0, skipped: 1 },
      assetPrices: { added: 0, skipped: 1 },
      investmentLots: { added: 0, skipped: 1 },
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
