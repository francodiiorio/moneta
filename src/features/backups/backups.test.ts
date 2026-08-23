import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { generateId } from '@/lib/ids'
import { buildBackupPayload, exportBackup } from './export'
import { importBackup } from './import'
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
