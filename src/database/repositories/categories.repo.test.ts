import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createCategory, listCategories } from './categories.repo'

afterEach(async () => {
  await db.categories.clear()
})

describe('createCategory', () => {
  it('assigns an incrementing order and defaults', async () => {
    const a = await createCategory({ name: 'Comida', kind: 'expense' })
    const b = await createCategory({ name: 'Sueldo', kind: 'income' })
    expect(a.order).toBe(0)
    expect(b.order).toBe(1)
    expect(a.isArchived).toBe(false)
  })
})

describe('listCategories', () => {
  it('orders categories by their order field', async () => {
    await createCategory({ name: 'Segunda', kind: 'expense' })
    await createCategory({ name: 'Primera', kind: 'expense' })
    const categories = await listCategories()
    expect(categories.map((c) => c.name)).toEqual(['Segunda', 'Primera'])
  })
})
