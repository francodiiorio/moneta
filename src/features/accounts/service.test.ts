import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/database/db'
import { createAccount } from '@/database/repositories/accounts.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import { saveIncome } from '@/database/repositories/incomes.repo'
import { money } from '@/domain/money'
import { adjustBalanceFromForm, getAccountBalancesAt, listAccountsWithBalances } from './service'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.incomes.clear(),
    db.expenses.clear(),
    db.accountAdjustments.clear(),
    db.categories.clear(),
  ])
})

async function seed() {
  const account = await createAccount({
    name: 'Galicia',
    type: 'bank',
    currency: 'ARS',
    openingBalance: 100_000,
    openingDate: '2026-10-01',
  })
  const incomeCategory = await createCategory({ kind: 'income', name: 'Sueldo' })
  const expenseCategory = await createCategory({ kind: 'expense', name: 'Comida' })
  await saveIncome({
    date: '2026-10-05',
    description: 'Sueldo',
    categoryId: incomeCategory.id,
    accountId: account.id,
    amount: 50_000,
    currency: 'ARS',
  })
  await saveExpense({
    date: '2026-10-06',
    description: 'Super',
    categoryId: expenseCategory.id,
    amount: 20_000,
    currency: 'ARS',
    status: 'confirmed',
    accountId: account.id,
  })
  // A credit-card gasto: never touches the account.
  await saveExpense({
    date: '2026-10-06',
    description: 'Tarjeta',
    categoryId: expenseCategory.id,
    amount: 99_999,
    currency: 'ARS',
    status: 'confirmed',
  })
  return account
}

describe('listAccountsWithBalances', () => {
  it('balance = opening + ingresos − gastos con débito, ignoring gastos without account', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
    try {
      await seed()
      const [account] = await listAccountsWithBalances()
      expect(account?.balance).toEqual(money(130_000, 'ARS'))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('getAccountBalancesAt', () => {
  it('one list per date, leaving out accounts not yet open', async () => {
    await seed()
    const balances = await getAccountBalancesAt(['2026-09-30', '2026-10-05', '2026-10-31'])
    expect(balances.get('2026-09-30')).toEqual([])
    expect(balances.get('2026-10-05')).toEqual([money(150_000, 'ARS')])
    expect(balances.get('2026-10-31')).toEqual([money(130_000, 'ARS')])
  })

  it('still counts an archived account', async () => {
    const account = await seed()
    await db.accounts.update(account.id, { isArchived: true })
    const balances = await getAccountBalancesAt(['2026-10-31'])
    expect(balances.get('2026-10-31')).toEqual([money(130_000, 'ARS')])
  })
})

describe('adjustBalanceFromForm', () => {
  it('stores the difference between the real and computed balance at that date', async () => {
    const account = await seed()
    const result = await adjustBalanceFromForm(account, { realBalance: '1.298,50', date: '2026-10-20', description: 'Comisión' })
    expect(result).toEqual({ adjusted: true, difference: money(-150, 'ARS') })

    const balances = await getAccountBalancesAt(['2026-10-20'])
    expect(balances.get('2026-10-20')).toEqual([money(129_850, 'ARS')])
    expect(await db.accountAdjustments.toArray()).toEqual([
      expect.objectContaining({ amount: -150, description: 'Comisión', date: '2026-10-20' }),
    ])
  })

  it('writes nothing when the balance already matches', async () => {
    const account = await seed()
    const result = await adjustBalanceFromForm(account, { realBalance: '1300', date: '2026-10-20', description: '' })
    expect(result).toEqual({ adjusted: false })
    expect(await db.accountAdjustments.count()).toBe(0)
  })

  it('rejects a date before the opening date', async () => {
    const account = await seed()
    await expect(
      adjustBalanceFromForm(account, { realBalance: '1', date: '2026-09-01', description: '' }),
    ).rejects.toThrow(/saldo inicial/)
  })
})

describe('adjustBalanceFromForm — concurrency', () => {
  it('a double submit stores the difference once, not twice', async () => {
    const account = await seed()
    const values = { realBalance: '1.298,50', date: '2026-10-20', description: '' }
    await Promise.all([adjustBalanceFromForm(account, values), adjustBalanceFromForm(account, values)])
    expect(await db.accountAdjustments.count()).toBe(1)
    const balances = await getAccountBalancesAt(['2026-10-20'])
    expect(balances.get('2026-10-20')).toEqual([money(129_850, 'ARS')])
  })
})
