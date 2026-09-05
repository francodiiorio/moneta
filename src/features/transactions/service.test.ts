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
    const category = await createCategory({ name: 'Comida' })

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
    const category = await createCategory({ name: 'Comida' })

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
    const category = await createCategory({ name: 'Comida' })
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
    const category = await createCategory({ name: 'Comida' })
    await saveExpense({ date: '2026-08-23', description: 'Super', categoryId: category.id, currency: 'ARS', amount: '500' })

    expect(await listTransactionsForMonth('2026-07')).toHaveLength(0)
    expect(await listTransactionsForMonth('2026-08')).toHaveLength(1)
  })

  it('filters by categoryId', async () => {
    const a = await createCategory({ name: 'Comida' })
    const b = await createCategory({ name: 'Transporte' })
    await saveExpense({ date: '2026-08-23', description: 'Super', categoryId: a.id, currency: 'ARS', amount: '500' })
    await saveExpense({ date: '2026-08-24', description: 'Colectivo', categoryId: b.id, currency: 'ARS', amount: '100' })

    const filtered = await listTransactionsForMonth('2026-08', { categoryId: a.id })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.categoryId).toBe(a.id)
  })

  it('hides an archived category from the picker but keeps its name on past expenses', async () => {
    const category = await createCategory({ name: 'Comida' })
    await saveExpense({ date: '2026-08-23', description: 'Supermercado', categoryId: category.id, currency: 'ARS', amount: '500' })

    await setCategoryArchived(category.id, true)

    const pickerOptions = await listCategories()
    expect(pickerOptions.find((c) => c.id === category.id)).toBeUndefined()

    const [item] = await listTransactionsForMonth('2026-08')
    expect(item?.categoryLabel).toBe('Comida')
  })

  it('carries a category\'s color/icon, omitting them when unset', async () => {
    const withIdentity = await createCategory({ name: 'Comida', color: '#ef4444', icon: 'utensils' })
    const withoutIdentity = await createCategory({ name: 'Otros' })

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
