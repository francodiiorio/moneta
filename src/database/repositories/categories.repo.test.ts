import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  createCategory,
  listCategories,
  moveCategory,
  seedDefaultsIfEmpty,
  setCategoryArchived,
  updateCategory,
} from './categories.repo'

afterEach(async () => {
  await db.categories.clear()
})

describe('createCategory', () => {
  it('assigns an incrementing order and defaults', async () => {
    const a = await createCategory({ kind: 'expense', name: 'Comida' })
    const b = await createCategory({ kind: 'expense', name: 'Transporte' })
    expect(a.order).toBe(0)
    expect(b.order).toBe(1)
    expect(a.isArchived).toBe(false)
  })

  it('accepts a top-level category as a parent', async () => {
    const parent = await createCategory({ kind: 'expense', name: 'Comida' })
    const child = await createCategory({ kind: 'expense', name: 'Restaurantes', parentId: parent.id })
    expect(child.parentId).toBe(parent.id)
  })

  it('rejects more than one level of hierarchy', async () => {
    const parent = await createCategory({ kind: 'expense', name: 'Comida' })
    const child = await createCategory({ kind: 'expense', name: 'Restaurantes', parentId: parent.id })
    await expect(
      createCategory({ kind: 'expense', name: 'Delivery', parentId: child.id }),
    ).rejects.toThrow(/sólo se admite un nivel/)
  })

  it('sets color/icon when given, omits them when not', async () => {
    const withIdentity = await createCategory({ kind: 'expense', name: 'Comida', color: '#ef4444', icon: 'utensils' })
    expect(withIdentity.color).toBe('#ef4444')
    expect(withIdentity.icon).toBe('utensils')

    const withoutIdentity = await createCategory({ kind: 'expense', name: 'Otros' })
    expect(withoutIdentity.color).toBeUndefined()
    expect(withoutIdentity.icon).toBeUndefined()
  })
})

describe('listCategories', () => {
  it('orders categories by their order field', async () => {
    await createCategory({ kind: 'expense', name: 'Segunda' })
    await createCategory({ kind: 'expense', name: 'Primera' })
    const categories = await listCategories()
    expect(categories.map((c) => c.name)).toEqual(['Segunda', 'Primera'])
  })
})

describe('updateCategory', () => {
  it('updates the name without touching parentId', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await updateCategory(category.id, { name: 'Comida y bebida' })
    const updated = await db.categories.get(category.id)
    expect(updated?.name).toBe('Comida y bebida')
    expect(updated?.parentId).toBeUndefined()
  })

  it('sets color/icon', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await updateCategory(category.id, { color: '#3b82f6', icon: 'utensils' })
    const updated = await db.categories.get(category.id)
    expect(updated?.color).toBe('#3b82f6')
    expect(updated?.icon).toBe('utensils')
  })

  it('clears a previously-set color/icon when given undefined', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida', color: '#3b82f6', icon: 'utensils' })
    await updateCategory(category.id, { color: undefined, icon: undefined })
    const updated = await db.categories.get(category.id)
    expect(updated?.color).toBeUndefined()
    expect(updated?.icon).toBeUndefined()
  })

  it('omitting color/icon from the patch leaves them untouched', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida', color: '#3b82f6', icon: 'utensils' })
    await updateCategory(category.id, { name: 'Comida y bebida' })
    const updated = await db.categories.get(category.id)
    expect(updated?.color).toBe('#3b82f6')
    expect(updated?.icon).toBe('utensils')
  })
})

describe('setCategoryArchived', () => {
  it('archives and restores a category', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await setCategoryArchived(category.id, true)
    expect((await db.categories.get(category.id))?.isArchived).toBe(true)
    await setCategoryArchived(category.id, false)
    expect((await db.categories.get(category.id))?.isArchived).toBe(false)
  })

  it('refuses to archive a parent that still has an active child', async () => {
    const parent = await createCategory({ kind: 'expense', name: 'Comida' })
    await createCategory({ kind: 'expense', name: 'Restaurantes', parentId: parent.id })

    await expect(setCategoryArchived(parent.id, true)).rejects.toThrow(/subcategorías activas/)
    expect((await db.categories.get(parent.id))?.isArchived).toBe(false)
  })

  it('allows archiving a parent once its children are archived', async () => {
    const parent = await createCategory({ kind: 'expense', name: 'Comida' })
    const child = await createCategory({ kind: 'expense', name: 'Restaurantes', parentId: parent.id })

    await setCategoryArchived(child.id, true)
    await setCategoryArchived(parent.id, true)
    expect((await db.categories.get(parent.id))?.isArchived).toBe(true)
  })
})

describe('moveCategory', () => {
  it('swaps order with the adjacent sibling', async () => {
    await createCategory({ kind: 'expense', name: 'A' })
    const b = await createCategory({ kind: 'expense', name: 'B' })
    await createCategory({ kind: 'expense', name: 'C' })

    await moveCategory(b.id, 'up')
    const afterUp = await listCategories()
    expect(afterUp.map((cat) => cat.name)).toEqual(['B', 'A', 'C'])

    await moveCategory(b.id, 'down')
    await moveCategory(b.id, 'down')
    const afterDown = await listCategories()
    expect(afterDown.map((cat) => cat.name)).toEqual(['A', 'C', 'B'])
  })

  it('is a no-op at either end of the sibling group', async () => {
    const a = await createCategory({ kind: 'expense', name: 'A' })
    const b = await createCategory({ kind: 'expense', name: 'B' })

    await moveCategory(a.id, 'up')
    expect((await listCategories()).map((c) => c.name)).toEqual(['A', 'B'])

    await moveCategory(b.id, 'down')
    expect((await listCategories()).map((c) => c.name)).toEqual(['A', 'B'])
  })

  it('never swaps across different parents', async () => {
    const parent = await createCategory({ kind: 'expense', name: 'Transporte' })
    const child = await createCategory({ kind: 'expense', name: 'Nafta', parentId: parent.id })
    await createCategory({ kind: 'expense', name: 'Comida' })

    // A child category's sibling group is scoped by parentId, so this
    // is a no-op even though other top-level categories exist.
    await moveCategory(child.id, 'up')
    expect((await db.categories.get(child.id))?.order).toBe(1)
    expect((await db.categories.get(parent.id))?.order).toBe(0)
  })
})

describe('seedDefaultsIfEmpty', () => {
  it('inserts the starter set only when the table is empty', async () => {
    await seedDefaultsIfEmpty()
    const seeded = await listCategories()
    expect(seeded.length).toBeGreaterThan(0)
    expect(seeded.some((c) => c.name === 'Comida')).toBe(true)
  })

  it('does not duplicate if a category already exists', async () => {
    await createCategory({ kind: 'expense', name: 'Mi categoría' })
    await seedDefaultsIfEmpty()
    const categories = await listCategories()
    expect(categories).toEqual([expect.objectContaining({ name: 'Mi categoría' })])
  })
})

describe('category kind (Etapa 8)', () => {
  it('listActiveCategories only returns the requested kind', async () => {
    const { listActiveCategories } = await import('./categories.repo')
    await createCategory({ kind: 'expense', name: 'Comida' })
    await createCategory({ kind: 'income', name: 'Sueldo' })
    expect((await listActiveCategories('expense')).map((c) => c.name)).toEqual(['Comida'])
    expect((await listActiveCategories('income')).map((c) => c.name)).toEqual(['Sueldo'])
  })

  it('a subcategory must share its parent kind', async () => {
    const parent = await createCategory({ kind: 'expense', name: 'Comida' })
    await expect(createCategory({ kind: 'income', name: 'Reintegros', parentId: parent.id })).rejects.toThrow(
      /mismo tipo/,
    )
  })

  it('seedIncomeDefaultsIfNone seeds once, after any expense categories, and never duplicates', async () => {
    const { seedIncomeDefaultsIfNone, listCategories } = await import('./categories.repo')
    await seedDefaultsIfEmpty()
    await seedIncomeDefaultsIfNone()
    await seedIncomeDefaultsIfNone()
    const categories = await listCategories()
    const income = categories.filter((c) => c.kind === 'income')
    expect(income.map((c) => c.name)).toEqual(['Sueldo', 'Otros ingresos'])
    expect(categories.filter((c) => c.kind === 'expense').length).toBeGreaterThan(0)
    // Appended after the expense seed, never interleaved with it.
    const maxExpenseOrder = Math.max(...categories.filter((c) => c.kind === 'expense').map((c) => c.order))
    expect(income.every((c) => c.order > maxExpenseOrder)).toBe(true)
  })
})

describe('moveCategory — kinds', () => {
  it('never swaps a gasto category with an ingreso one', async () => {
    const { moveCategory, listCategories } = await import('./categories.repo')
    const lastExpense = await createCategory({ kind: 'expense', name: 'Otros' })
    const firstIncome = await createCategory({ kind: 'income', name: 'Sueldo' })

    await moveCategory(lastExpense.id, 'down')

    const byId = new Map((await listCategories()).map((c) => [c.id, c.order]))
    expect(byId.get(lastExpense.id)).toBe(lastExpense.order)
    expect(byId.get(firstIncome.id)).toBe(firstIncome.order)
  })
})
