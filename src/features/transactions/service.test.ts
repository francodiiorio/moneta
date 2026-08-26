import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createAccount, listAccountsWithBalances } from '@/database/repositories/accounts.repo'
import { createCategory, setCategoryArchived } from '@/database/repositories/categories.repo'
import { minor } from '@/domain/money'
import {
  listCategoriesByKind,
  listTransactionsForMonth,
  saveExpenseIncome,
  saveTransfer,
  type TransactionListItem,
} from './service'
import type { ExpenseIncomeFormValues, TransferFormValues } from './schema'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
  ])
})

describe('saveExpenseIncome', () => {
  it('rejects a zero or negative amount instead of silently reversing the balance', async () => {
    const account = await createAccount({
      name: 'Banco',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(1000),
    })
    const category = await createCategory({ name: 'Comida', kind: 'expense' })
    const accounts = await listAccountsWithBalances()

    const values: ExpenseIncomeFormValues = {
      date: '2026-08-23',
      description: 'x',
      accountId: account.id,
      categoryId: category.id,
      amount: '0',
    }
    await expect(saveExpenseIncome('expense', values, accounts)).rejects.toThrow(/mayor a cero/)
    expect(await db.transactions.count()).toBe(0)
  })
})

describe('saveTransfer (cross-currency)', () => {
  it('derives a consistent rate and persists both legs', async () => {
    const from = await createAccount({ name: 'Banco ARS', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const to = await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })
    const accounts = await listAccountsWithBalances()

    const values: TransferFormValues = {
      date: '2026-08-23',
      description: 'Compra de dólares',
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: '120000',
      toAmount: '100',
    }
    await saveTransfer(values, accounts)

    const balances = await listAccountsWithBalances()
    const arsBalance = balances.find((a) => a.id === from.id)?.balance
    const usdBalance = balances.find((a) => a.id === to.id)?.balance
    // "120000"/"100" are parsed as major-unit amounts ($120.000,00 / $100,00),
    // i.e. 12_000_000 / 10_000 minor units — see domain/money/money.ts parseAmount.
    expect(arsBalance).toBe(-12_000_000)
    expect(usdBalance).toBe(10_000)
  })
})

describe('listTransactionsForMonth', () => {
  async function seedTransfer() {
    const from = await createAccount({ name: 'Banco ARS', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const to = await createAccount({ name: 'Efectivo', type: 'cash', currency: 'ARS', openingBalance: minor(0) })
    const accounts = await listAccountsWithBalances()
    await saveTransfer(
      {
        date: '2026-08-23',
        description: 'Ahorro',
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: '2000',
      },
      accounts,
    )
    return { from, to }
  }

  it('resolves the from/to account labels for a transfer using the posting signs', async () => {
    const { from, to } = await seedTransfer()
    const [item] = await listTransactionsForMonth('2026-08')
    expect(item?.accountLabel).toBe(`${from.name} → ${to.name}`)
    expect(item?.fromAccountId).toBe(from.id)
    expect(item?.toAccountId).toBe(to.id)
  })

  it('excludes a transaction when filtered by an unrelated account', async () => {
    const { from } = await seedTransfer()
    const otherAccount = await createAccount({
      name: 'Otra cuenta',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(0),
    })

    const filtered = await listTransactionsForMonth('2026-08', { accountId: otherAccount.id })
    expect(filtered).toHaveLength(0)

    const included = await listTransactionsForMonth('2026-08', { accountId: from.id })
    expect(included).toHaveLength(1)
  })

  it('excludes transactions outside the requested month', async () => {
    await seedTransfer()
    const items: TransactionListItem[] = await listTransactionsForMonth('2026-07')
    expect(items).toHaveLength(0)
  })

  it('hides an archived category from the picker but keeps its name on past transactions', async () => {
    const account = await createAccount({
      name: 'Banco',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(1000),
    })
    const category = await createCategory({ name: 'Comida', kind: 'expense' })
    const accounts = await listAccountsWithBalances()
    await saveExpenseIncome(
      'expense',
      { date: '2026-08-23', description: 'Supermercado', accountId: account.id, categoryId: category.id, amount: '500' },
      accounts,
    )

    await setCategoryArchived(category.id, true)

    const pickerOptions = await listCategoriesByKind('expense')
    expect(pickerOptions.find((c) => c.id === category.id)).toBeUndefined()

    const [item] = await listTransactionsForMonth('2026-08')
    expect(item?.categoryLabel).toBe('Comida')
  })

  it('carries a category\'s color/icon, omitting them when unset', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(1000) })
    const withIdentity = await createCategory({ name: 'Comida', kind: 'expense', color: '#ef4444', icon: 'utensils' })
    const withoutIdentity = await createCategory({ name: 'Otros', kind: 'expense' })
    const accounts = await listAccountsWithBalances()

    await saveExpenseIncome(
      'expense',
      { date: '2026-08-01', description: 'Super', accountId: account.id, categoryId: withIdentity.id, amount: '500' },
      accounts,
    )
    await saveExpenseIncome(
      'expense',
      { date: '2026-08-02', description: 'Otro', accountId: account.id, categoryId: withoutIdentity.id, amount: '300' },
      accounts,
    )

    const items = await listTransactionsForMonth('2026-08')
    const withIdentityItem = items.find((i) => i.categoryLabel === 'Comida')
    const withoutIdentityItem = items.find((i) => i.categoryLabel === 'Otros')

    expect(withIdentityItem?.categoryColor).toBe('#ef4444')
    expect(withIdentityItem?.categoryIcon).toBe('utensils')
    expect(withoutIdentityItem?.categoryColor).toBeUndefined()
    expect(withoutIdentityItem?.categoryIcon).toBeUndefined()
  })
})
