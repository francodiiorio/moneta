import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createCategory } from './categories.repo'
import { createInstallmentPlan, deleteInstallmentPlan, listInstallmentPlans } from './installmentPlans.repo'

afterEach(async () => {
  await Promise.all([db.categories.clear(), db.expenses.clear(), db.installmentPlans.clear()])
})

async function setup() {
  const category = await createCategory({ name: 'Compras' })
  return { category }
}

describe('createInstallmentPlan', () => {
  it('writes N expenses matching scheduleCache, confirmed on/before today and projected after', async () => {
    const { category } = await setup()

    const plan = await createInstallmentPlan(
      {
        description: 'Notebook',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 10_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-08-15', // "today" — only the first cuota (2026-08-01) is due
    )

    expect(plan.scheduleCache.reduce((a, b) => a + b, 0)).toBe(10_000)
    expect(await listInstallmentPlans()).toHaveLength(1)

    const expenses = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(expenses).toHaveLength(3)
    expenses.sort((a, b) => a.date.localeCompare(b.date))
    expect(expenses.map((e) => e.status)).toEqual(['confirmed', 'projected', 'projected'])
    expect(expenses.map((e) => e.date)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
  })

  it('creates every cuota as projected when today is before all of them', async () => {
    const { category } = await setup()

    await createInstallmentPlan(
      {
        description: 'Notebook',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 9_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-06-01', // "today" is before every cuota — all projected
    )

    const projected = await db.expenses.where('status').equals('projected').toArray()
    expect(projected).toHaveLength(3)
  })

  it('rejects a non-positive total or count', async () => {
    const { category } = await setup()
    const base = {
      description: 'Notebook',
      categoryId: category.id,
      currency: 'ARS' as const,
      firstDueDate: '2026-08-01',
      purchaseDate: '2026-07-15',
    }
    await expect(createInstallmentPlan({ ...base, totalAmount: 0, count: 3 })).rejects.toThrow(/mayor a cero/)
    await expect(createInstallmentPlan({ ...base, totalAmount: 9_000, count: 0 })).rejects.toThrow(/mayor a cero/)
    expect(await listInstallmentPlans()).toEqual([])
  })
})

describe('deleteInstallmentPlan', () => {
  it('deletes projected cuotas but keeps confirmed ones', async () => {
    const { category } = await setup()
    const plan = await createInstallmentPlan(
      {
        description: 'Notebook',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 9_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-08-15', // only the first cuota is confirmed
    )

    await deleteInstallmentPlan(plan.id)

    expect(await listInstallmentPlans()).toEqual([])
    const remaining = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.status).toBe('confirmed')
  })
})
