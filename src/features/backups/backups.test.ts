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

describe('backup round-trip', () => {
  it('reconstructs an identical database state after export -> wipe -> import', async () => {
    await seedFullDatabase()

    const before = {
      accounts: sortById(await db.accounts.toArray()),
      categories: sortById(await db.categories.toArray()),
      transactions: sortById(await db.transactions.toArray()),
      postings: sortById(await db.postings.toArray()),
      budgets: sortById(await db.budgets.toArray()),
      exchangeRates: sortById(await db.exchangeRates.toArray()),
      settings: await db.settings.get('singleton'),
    }

    const exported = await exportBackup()
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    await Promise.all([
      db.accounts.clear(),
      db.categories.clear(),
      db.transactions.clear(),
      db.postings.clear(),
      db.budgets.clear(),
      db.exchangeRates.clear(),
      db.settings.clear(),
    ])
    expect(await db.accounts.count()).toBe(0)

    const result = await importBackup(file)
    expect(result.checksumMatched).toBe(true)

    const after = {
      accounts: sortById(await db.accounts.toArray()),
      categories: sortById(await db.categories.toArray()),
      transactions: sortById(await db.transactions.toArray()),
      postings: sortById(await db.postings.toArray()),
      budgets: sortById(await db.budgets.toArray()),
      exchangeRates: sortById(await db.exchangeRates.toArray()),
      settings: await db.settings.get('singleton'),
    }

    expect(after).toEqual(before)
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

    const before = {
      accounts: sortById(await db.accounts.toArray()),
      categories: sortById(await db.categories.toArray()),
      transactions: sortById(await db.transactions.toArray()),
      postings: sortById(await db.postings.toArray()),
      budgets: sortById(await db.budgets.toArray()),
      exchangeRates: sortById(await db.exchangeRates.toArray()),
      settings: await db.settings.get('singleton'),
    }

    const exported = await exportBackup('correcto-caballo-batería-grapa')
    const file = new File([exported.blob], exported.filename, { type: 'application/json' })

    // An encrypted export is not readable JSON of the underlying data —
    // the whole point of this feature.
    const rawText = await exported.blob.text()
    expect(rawText).not.toContain('Banco')
    expect(rawText).not.toContain('Supermercado')

    expect(await peekIsEncrypted(file)).toBe(true)

    await Promise.all([
      db.accounts.clear(),
      db.categories.clear(),
      db.transactions.clear(),
      db.postings.clear(),
      db.budgets.clear(),
      db.exchangeRates.clear(),
      db.settings.clear(),
    ])

    const result = await importBackup(file, { passphrase: 'correcto-caballo-batería-grapa' })
    expect(result.checksumMatched).toBe(true)

    const after = {
      accounts: sortById(await db.accounts.toArray()),
      categories: sortById(await db.categories.toArray()),
      transactions: sortById(await db.transactions.toArray()),
      postings: sortById(await db.postings.toArray()),
      budgets: sortById(await db.budgets.toArray()),
      exchangeRates: sortById(await db.exchangeRates.toArray()),
      settings: await db.settings.get('singleton'),
    }

    expect(after).toEqual(before)
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

    await Promise.all([
      db.accounts.clear(),
      db.categories.clear(),
      db.transactions.clear(),
      db.postings.clear(),
      db.budgets.clear(),
      db.exchangeRates.clear(),
      db.settings.clear(),
    ])

    // A second, independent dataset — seedFullDatabase() mints fresh ids
    // every call, so this never collides with deviceA's.
    const deviceB = await seedFullDatabase()

    const result = await importBackup(file, { mode: 'merge' })
    expect(result.checksumMatched).toBe(true)
    expect(result.merged).toEqual({
      accounts: { added: 1, skipped: 0 },
      categories: { added: 1, skipped: 0 },
      transactions: { added: 1, skipped: 0 },
      recurringPlans: { added: 0, skipped: 0 },
      installmentPlans: { added: 0, skipped: 0 },
      budgets: { added: 1, skipped: 0 },
      exchangeRates: { added: 1, skipped: 0 },
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
      recurringPlans: { added: 0, skipped: 0 },
      installmentPlans: { added: 0, skipped: 0 },
      budgets: { added: 0, skipped: 1 },
      exchangeRates: { added: 0, skipped: 1 },
    })
    expect(await db.transactions.count()).toBe(countBefore)
  })
})
