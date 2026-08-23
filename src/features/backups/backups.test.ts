import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { generateId } from '@/lib/ids'
import { buildBackupPayload, exportBackup } from './export'
import { importBackup, PassphraseRequiredError, peekIsEncrypted } from './import'
import { migrateToLatest } from './migrations'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
    db.recurringPlans.clear(),
    db.installmentPlans.clear(),
    db.budgets.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
  ])
})

async function seedFullDatabase() {
  const now = new Date().toISOString()

  const account = {
    id: generateId(),
    name: 'Banco',
    type: 'bank' as const,
    currency: 'ARS',
    openingBalance: 100_000,
    isArchived: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.accounts.add(account)

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

  const transaction = {
    id: generateId(),
    date: '2026-08-23',
    kind: 'expense' as const,
    description: 'Supermercado',
    status: 'confirmed' as const,
    createdAt: now,
    updatedAt: now,
  }
  await db.transactions.add(transaction)

  await db.postings.bulkAdd([
    {
      id: generateId(),
      transactionId: transaction.id,
      target: 'account' as const,
      accountId: account.id,
      amount: -1500,
      currency: 'ARS',
      date: '2026-08-23',
    },
    {
      id: generateId(),
      transactionId: transaction.id,
      target: 'category' as const,
      categoryId: category.id,
      amount: 1500,
      currency: 'ARS',
      date: '2026-08-23',
    },
  ])

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
      kind: 'expense' as const,
      accountId: account.id,
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
    accountId: account.id,
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

  return { account, category, transaction }
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

async function snapshotAllTables() {
  return {
    accounts: sortById(await db.accounts.toArray()),
    categories: sortById(await db.categories.toArray()),
    transactions: sortById(await db.transactions.toArray()),
    postings: sortById(await db.postings.toArray()),
    recurringPlans: sortById(await db.recurringPlans.toArray()),
    installmentPlans: sortById(await db.installmentPlans.toArray()),
    budgets: sortById(await db.budgets.toArray()),
    exchangeRates: sortById(await db.exchangeRates.toArray()),
    savingsHoldings: sortById(await db.savingsHoldings.toArray()),
    investmentAssets: sortById(await db.investmentAssets.toArray()),
    investmentHoldings: sortById(await db.investmentHoldings.toArray()),
    assetPrices: sortById(await db.assetPrices.toArray()),
    settings: await db.settings.get('singleton'),
  }
}

async function clearAllTables() {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
    db.recurringPlans.clear(),
    db.installmentPlans.clear(),
    db.budgets.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
  ])
}

describe('backup round-trip', () => {
  it('reconstructs an identical database state after export -> wipe -> import', async () => {
    await seedFullDatabase()
    const before = await snapshotAllTables()

    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    await clearAllTables()
    expect(await db.accounts.count()).toBe(0)

    const result = await importBackup(file)
    expect(result.checksumMatched).toBe(true)

    expect(await snapshotAllTables()).toEqual(before)
  })

  it('rejects a backup with unbalanced postings before writing anything', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    payload.data.postings[0]!.amount = -9999 // break the double-entry balance

    const file = new File([JSON.stringify(payload)], 'broken.finance', {
      type: 'application/json',
    })

    const countBefore = await db.transactions.count()
    await expect(importBackup(file)).rejects.toThrow(/Transacción inválida/)
    expect(await db.transactions.count()).toBe(countBefore) // nothing was written
  })

  it('rejects a backup with an "auto" priceMode investment asset that is not crypto', async () => {
    await seedFullDatabase()
    const payload = await buildBackupPayload()
    payload.data.investmentAssets[0]!.priceMode = 'auto' // seeded asset is an 'etf', not 'crypto'

    const file = new File([JSON.stringify(payload)], 'broken.finance', { type: 'application/json' })

    const countBefore = await db.accounts.count()
    await expect(importBackup(file)).rejects.toThrow(/El backup no es válido/)
    expect(await db.accounts.count()).toBe(countBefore) // nothing was written
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

    const exported = await exportBackup('correcto-caballo-batería-grapa')
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    // An encrypted export is not readable JSON of the underlying data —
    // the whole point of this feature.
    const rawText = await exported.blob.text()
    expect(rawText).not.toContain('Banco')
    expect(rawText).not.toContain('Supermercado')

    expect(await peekIsEncrypted(file)).toBe(true)

    await clearAllTables()

    const result = await importBackup(file, { passphrase: 'correcto-caballo-batería-grapa' })
    expect(result.checksumMatched).toBe(true)

    expect(await snapshotAllTables()).toEqual(before)
  })

  it('requires a passphrase for an encrypted file, and does not write anything without one', async () => {
    await seedFullDatabase()
    const exported = await exportBackup('contraseña')
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    const countBefore = await db.transactions.count()
    await expect(importBackup(file)).rejects.toThrow(PassphraseRequiredError)
    expect(await db.transactions.count()).toBe(countBefore)
  })

  it('rejects the wrong passphrase, and does not write anything', async () => {
    await seedFullDatabase()
    const exported = await exportBackup('contraseña-correcta')
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    const countBefore = await db.transactions.count()
    await expect(importBackup(file, { passphrase: 'contraseña-incorrecta' })).rejects.toThrow(/Contraseña incorrecta/)
    expect(await db.transactions.count()).toBe(countBefore)
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
      accounts: { added: 1, skipped: 0 },
      categories: { added: 1, skipped: 0 },
      transactions: { added: 1, skipped: 0 },
      recurringPlans: { added: 1, skipped: 0 },
      installmentPlans: { added: 1, skipped: 0 },
      budgets: { added: 1, skipped: 0 },
      exchangeRates: { added: 1, skipped: 0 },
      savingsHoldings: { added: 1, skipped: 0 },
      investmentAssets: { added: 1, skipped: 0 },
      investmentHoldings: { added: 1, skipped: 0 },
      assetPrices: { added: 1, skipped: 0 },
    })

    const accountIds = (await db.accounts.toArray()).map((a) => a.id).sort()
    expect(accountIds).toEqual([deviceA.account.id, deviceB.account.id].sort())
    const transactionIds = (await db.transactions.toArray()).map((t) => t.id).sort()
    expect(transactionIds).toEqual([deviceA.transaction.id, deviceB.transaction.id].sort())
    // Local settings (from deviceB's seed) were never touched by the merge.
    expect((await db.settings.get('singleton'))?.baseCurrency).toBe('ARS')
  })

  it('merging the same backup twice in a row is idempotent (no duplicates the second time)', async () => {
    await seedFullDatabase()
    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    const first = await importBackup(file, { mode: 'merge' })
    expect(first.merged?.accounts).toEqual({ added: 0, skipped: 1 }) // same device, ids already exist

    const countBefore = await db.transactions.count()
    const second = await importBackup(file, { mode: 'merge' })
    expect(second.merged).toEqual({
      accounts: { added: 0, skipped: 1 },
      categories: { added: 0, skipped: 1 },
      transactions: { added: 0, skipped: 1 },
      recurringPlans: { added: 0, skipped: 1 },
      installmentPlans: { added: 0, skipped: 1 },
      budgets: { added: 0, skipped: 1 },
      exchangeRates: { added: 0, skipped: 1 },
      savingsHoldings: { added: 0, skipped: 1 },
      investmentAssets: { added: 0, skipped: 1 },
      investmentHoldings: { added: 0, skipped: 1 },
      assetPrices: { added: 0, skipped: 1 },
    })
    expect(await db.transactions.count()).toBe(countBefore)
  })
})

describe('migration — v1 to v2', () => {
  it('migrates a v1 backup (no patrimonio tables) to v2 with them empty', () => {
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

    expect(migrated.savingsHoldings).toEqual([])
    expect(migrated.investmentAssets).toEqual([])
    expect(migrated.investmentHoldings).toEqual([])
    expect(migrated.assetPrices).toEqual([])
  })

  it('importing a v1 .finance file (via importBackup) lands with the patrimonio tables empty', async () => {
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

    expect(await db.savingsHoldings.count()).toBe(0)
    expect(await db.investmentAssets.count()).toBe(0)
    expect(await db.investmentHoldings.count()).toBe(0)
    expect(await db.assetPrices.count()).toBe(0)
  })
})
