import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createAccount, listAccountsWithBalances } from './accounts.repo'
import { createCategory } from './categories.repo'
import { deleteTransaction, listTransactionsInRange, saveTransaction } from './transactions.repo'
import { buildExpense, buildFxTransfer } from '@/domain/ledger'
import { minor, money } from '@/domain/money'

afterEach(async () => {
  await Promise.all([db.accounts.clear(), db.categories.clear(), db.transactions.clear(), db.postings.clear()])
})

async function seedAccountAndCategory() {
  const account = await createAccount({
    name: 'Banco',
    type: 'bank',
    currency: 'ARS',
    openingBalance: minor(100_000),
  })
  const category = await createCategory({ name: 'Comida', kind: 'expense' })
  return { account, category }
}

describe('saveTransaction (create)', () => {
  it('persists a transaction with its postings and updates the account balance', async () => {
    const { account, category } = await seedAccountAndCategory()
    const entry = buildExpense({
      date: '2026-08-23',
      description: 'Supermercado',
      accountId: account.id,
      categoryId: category.id,
      amount: money(1500, 'ARS'),
    })

    const id = await saveTransaction(entry)

    const [item] = await listTransactionsInRange('2026-08-01', '2026-08-31')
    expect(item?.transaction.id).toBe(id)
    expect(item?.postings).toHaveLength(2)

    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(98_500)
  })

  it('rejects a cross-currency transfer whose legs do not match the stated rate, and writes nothing', async () => {
    const from = await createAccount({ name: 'Banco ARS', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const to = await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })

    const badEntry = buildFxTransfer({
      date: '2026-08-23',
      description: 'Compra de dólares mal calculada',
      fromAccountId: from.id,
      toAccountId: to.id,
      fromAmount: money(120_000, 'ARS'),
      toAmount: money(500, 'USD'), // inconsistent with the stated rate
      rate: 100 / 120_000,
    })

    await expect(saveTransaction(badEntry)).rejects.toThrow(/don't balance/)
    expect(await db.transactions.count()).toBe(0)
    expect(await db.postings.count()).toBe(0)
  })
})

describe('saveTransaction (edit)', () => {
  it('replaces postings, keeps the id and createdAt, and rebalances the account', async () => {
    const { account, category } = await seedAccountAndCategory()
    const original = buildExpense({
      date: '2026-08-23',
      description: 'Supermercado',
      accountId: account.id,
      categoryId: category.id,
      amount: money(1500, 'ARS'),
    })
    const id = await saveTransaction(original)
    const before = await db.transactions.get(id)

    const edited = buildExpense({
      date: '2026-08-24',
      description: 'Supermercado (corregido)',
      accountId: account.id,
      categoryId: category.id,
      amount: money(2000, 'ARS'),
    })
    await saveTransaction(edited, id)

    expect(await db.postings.where('transactionId').equals(id).count()).toBe(2)
    const after = await db.transactions.get(id)
    expect(after?.id).toBe(id)
    expect(after?.createdAt).toBe(before?.createdAt)
    expect(after?.description).toBe('Supermercado (corregido)')

    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(98_000) // 100000 - 2000, not -1500
  })
})

describe('deleteTransaction', () => {
  it('removes the transaction and its postings, restoring the opening balance', async () => {
    const { account, category } = await seedAccountAndCategory()
    const entry = buildExpense({
      date: '2026-08-23',
      description: 'Supermercado',
      accountId: account.id,
      categoryId: category.id,
      amount: money(1500, 'ARS'),
    })
    const id = await saveTransaction(entry)

    await deleteTransaction(id)

    expect(await db.transactions.get(id)).toBeUndefined()
    expect(await db.postings.where('transactionId').equals(id).count()).toBe(0)
    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(100_000)
  })
})

describe('listTransactionsInRange', () => {
  it('excludes transactions outside the date range', async () => {
    const { account, category } = await seedAccountAndCategory()
    await saveTransaction(
      buildExpense({
        date: '2026-07-31',
        description: 'Mes anterior',
        accountId: account.id,
        categoryId: category.id,
        amount: money(100, 'ARS'),
      }),
    )
    await saveTransaction(
      buildExpense({
        date: '2026-08-15',
        description: 'Este mes',
        accountId: account.id,
        categoryId: category.id,
        amount: money(200, 'ARS'),
      }),
    )

    const items = await listTransactionsInRange('2026-08-01', '2026-08-31')
    expect(items).toHaveLength(1)
    expect(items[0]?.transaction.description).toBe('Este mes')
  })
})
