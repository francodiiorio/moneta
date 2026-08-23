import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createBudget, deleteBudget, listBudgets } from './budgets.repo'

afterEach(async () => {
  await db.budgets.clear()
})

describe('createBudget / listBudgets', () => {
  it('creates and lists budgets', async () => {
    await createBudget({ categoryId: 'food', currency: 'ARS', period: 'monthly', amount: 50_000, startsOn: '2026-01' })
    const budgets = await listBudgets()
    expect(budgets).toHaveLength(1)
    expect(budgets[0]).toMatchObject({ categoryId: 'food', period: 'monthly', amount: 50_000, startsOn: '2026-01' })
  })

  it('rejects a non-positive amount', async () => {
    await expect(
      createBudget({ categoryId: 'food', currency: 'ARS', period: 'monthly', amount: 0, startsOn: '2026-01' }),
    ).rejects.toThrow(/mayor a cero/)
    await expect(
      createBudget({ categoryId: 'food', currency: 'ARS', period: 'monthly', amount: -100, startsOn: '2026-01' }),
    ).rejects.toThrow(/mayor a cero/)
    expect(await listBudgets()).toEqual([])
  })

  it('rejects a duplicate categoryId+period+startsOn', async () => {
    await createBudget({ categoryId: 'food', currency: 'ARS', period: 'monthly', amount: 50_000, startsOn: '2026-01' })
    await expect(
      createBudget({ categoryId: 'food', currency: 'ARS', period: 'monthly', amount: 60_000, startsOn: '2026-01' }),
    ).rejects.toThrow(/Ya existe un presupuesto/)
    expect(await listBudgets()).toHaveLength(1)
  })

  it('allows the same categoryId+startsOn for a different period', async () => {
    await createBudget({ categoryId: 'food', currency: 'ARS', period: 'monthly', amount: 50_000, startsOn: '2026-01' })
    await createBudget({ categoryId: 'food', currency: 'ARS', period: 'yearly', amount: 600_000, startsOn: '2026-01' })
    expect(await listBudgets()).toHaveLength(2)
  })
})

describe('deleteBudget', () => {
  it('removes a budget', async () => {
    const budget = await createBudget({
      categoryId: 'food',
      currency: 'ARS',
      period: 'monthly',
      amount: 50_000,
      startsOn: '2026-01',
    })
    await deleteBudget(budget.id)
    expect(await listBudgets()).toEqual([])
  })
})
