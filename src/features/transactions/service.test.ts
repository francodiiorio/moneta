import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createCategory, setCategoryArchived } from '@/database/repositories/categories.repo'
import { listCategories, listTransactionsForMonth, saveExpense } from './service'
import type { ExpenseFormValues } from './schema'

afterEach(async () => {
  await Promise.all([db.categories.clear(), db.expenses.clear()])
})

describe('saveExpense', () => {
  it('rejects a zero or negative amount', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })

    const values: ExpenseFormValues = {
      date: '2026-08-23',
      description: 'x',
      categoryId: category.id,
      currency: 'ARS',
      amount: '0',
    }
    await expect(saveExpense(values)).rejects.toThrow(/mayor a cero/)
    expect(await db.expenses.count()).toBe(0)
  })

  it('persists a confirmed expense with the parsed amount', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })

    await saveExpense({
      date: '2026-08-23',
      description: 'Supermercado',
      categoryId: category.id,
      currency: 'ARS',
      amount: '1.200,50',
    })

    const [expense] = await db.expenses.toArray()
    expect(expense).toMatchObject({
      description: 'Supermercado',
      categoryId: category.id,
      amount: 120_050,
      currency: 'ARS',
      status: 'confirmed',
    })
  })

  it('editing overwrites the existing expense instead of creating a new one', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await saveExpense({
      date: '2026-08-23',
      description: 'Supermercado',
      categoryId: category.id,
      currency: 'ARS',
      amount: '500',
    })
    const [first] = await db.expenses.toArray()
    const id = first!.id

    await saveExpense(
      { date: '2026-08-24', description: 'Super (editado)', categoryId: category.id, currency: 'ARS', amount: '600' },
      id,
    )

    expect(await db.expenses.count()).toBe(1)
    const updated = await db.expenses.get(id)
    expect(updated).toMatchObject({ description: 'Super (editado)', amount: 60_000, date: '2026-08-24' })
  })
})

describe('listTransactionsForMonth', () => {
  it('excludes expenses outside the requested month', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await saveExpense({ date: '2026-08-23', description: 'Super', categoryId: category.id, currency: 'ARS', amount: '500' })

    expect(await listTransactionsForMonth('2026-07')).toHaveLength(0)
    expect(await listTransactionsForMonth('2026-08')).toHaveLength(1)
  })

  it('filters by categoryId', async () => {
    const a = await createCategory({ kind: 'expense', name: 'Comida' })
    const b = await createCategory({ kind: 'expense', name: 'Transporte' })
    await saveExpense({ date: '2026-08-23', description: 'Super', categoryId: a.id, currency: 'ARS', amount: '500' })
    await saveExpense({ date: '2026-08-24', description: 'Colectivo', categoryId: b.id, currency: 'ARS', amount: '100' })

    const filtered = await listTransactionsForMonth('2026-08', { categoryId: a.id })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.categoryId).toBe(a.id)
  })

  it('hides an archived category from the picker but keeps its name on past expenses', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await saveExpense({ date: '2026-08-23', description: 'Supermercado', categoryId: category.id, currency: 'ARS', amount: '500' })

    await setCategoryArchived(category.id, true)

    const pickerOptions = await listCategories('expense')
    expect(pickerOptions.find((c) => c.id === category.id)).toBeUndefined()

    const [item] = await listTransactionsForMonth('2026-08')
    expect(item?.categoryLabel).toBe('Comida')
  })

  it('carries a category\'s color/icon, omitting them when unset', async () => {
    const withIdentity = await createCategory({ kind: 'expense', name: 'Comida', color: '#ef4444', icon: 'utensils' })
    const withoutIdentity = await createCategory({ kind: 'expense', name: 'Otros' })

    await saveExpense({ date: '2026-08-01', description: 'Super', categoryId: withIdentity.id, currency: 'ARS', amount: '500' })
    await saveExpense({ date: '2026-08-02', description: 'Otro', categoryId: withoutIdentity.id, currency: 'ARS', amount: '300' })

    const items = await listTransactionsForMonth('2026-08')
    const withIdentityItem = items.find((i) => i.categoryLabel === 'Comida')
    const withoutIdentityItem = items.find((i) => i.categoryLabel === 'Otros')

    expect(withIdentityItem?.categoryColor).toBe('#ef4444')
    expect(withIdentityItem?.categoryIcon).toBe('utensils')
    expect(withoutIdentityItem?.categoryColor).toBeUndefined()
    expect(withoutIdentityItem?.categoryIcon).toBeUndefined()
  })
})

describe('ingresos y cuentas en Movimientos (Etapa 8)', () => {
  afterEach(async () => {
    await Promise.all([db.accounts.clear(), db.incomes.clear()])
  })

  async function seedAccount(currency = 'ARS') {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    return createAccount({ name: 'Galicia', type: 'bank', currency, openingBalance: 0, openingDate: '2026-08-01' })
  }

  it('saveMovement routes an ingreso to incomes and lists it positive, next to gastos', async () => {
    const { saveMovement } = await import('./service')
    const account = await seedAccount()
    const incomeCategory = await createCategory({ kind: 'income', name: 'Sueldo' })
    const expenseCategory = await createCategory({ kind: 'expense', name: 'Comida' })

    await saveMovement({
      kind: 'income',
      date: '2026-08-05',
      description: 'Sueldo',
      categoryId: incomeCategory.id,
      currency: 'ARS',
      amount: '1000',
      accountId: account.id,
    })
    await saveMovement({
      kind: 'expense',
      date: '2026-08-06',
      description: 'Super',
      categoryId: expenseCategory.id,
      currency: 'ARS',
      amount: '200',
      accountId: '',
    })

    const items = await listTransactionsForMonth('2026-08')
    expect(items.map((i) => [i.kind, i.description, i.amount.amount, i.accountLabel])).toEqual([
      ['expense', 'Super', -200_00, undefined],
      ['income', 'Sueldo', 1000_00, 'Galicia'],
    ])
    const [expense] = await db.expenses.toArray()
    expect(expense?.accountId).toBeUndefined()
  })

  it('filters by account', async () => {
    const { saveMovement } = await import('./service')
    const account = await seedAccount()
    const expenseCategory = await createCategory({ kind: 'expense', name: 'Comida' })
    const base = { kind: 'expense' as const, date: '2026-08-06', categoryId: expenseCategory.id, currency: 'ARS', amount: '200' }
    await saveMovement({ ...base, description: 'Con débito', accountId: account.id })
    await saveMovement({ ...base, description: 'Sin cuenta', accountId: '' })

    const items = await listTransactionsForMonth('2026-08', { accountId: account.id })
    expect(items.map((i) => i.description)).toEqual(['Con débito'])
  })

  it('removeTransaction deletes from the right table by kind', async () => {
    const { saveMovement, removeTransaction } = await import('./service')
    const account = await seedAccount()
    const incomeCategory = await createCategory({ kind: 'income', name: 'Sueldo' })
    await saveMovement({
      kind: 'income',
      date: '2026-08-05',
      description: 'Sueldo',
      categoryId: incomeCategory.id,
      currency: 'ARS',
      amount: '1000',
      accountId: account.id,
    })
    const [item] = await listTransactionsForMonth('2026-08')
    await removeTransaction(item!.id, item!.kind)
    expect(await db.incomes.count()).toBe(0)
  })
})

describe('ajustes de saldo en Movimientos', () => {
  afterEach(async () => {
    await Promise.all([db.accounts.clear(), db.accountAdjustments.clear()])
  })

  it('lists an adjustment (signed, no category) and deletes it', async () => {
    const { removeTransaction } = await import('./service')
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const { createAdjustment } = await import('@/database/repositories/accountAdjustments.repo')
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-08-01' })
    await createAdjustment({ accountId: account.id, date: '2026-08-10', amount: -150, currency: 'ARS' })

    const [item] = await listTransactionsForMonth('2026-08')
    expect(item).toMatchObject({ kind: 'adjustment', description: 'Ajuste de saldo', accountLabel: 'Galicia' })
    expect(item?.amount.amount).toBe(-150)

    await removeTransaction(item!.id, item!.kind)
    expect(await db.accountAdjustments.count()).toBe(0)
  })
})
