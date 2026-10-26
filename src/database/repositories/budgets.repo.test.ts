import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createBudget, deleteBudget, listBudgets, setBudgetAmountFrom } from './budgets.repo'

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

describe('setBudgetAmountFrom', () => {
  const base = { categoryId: 'food', currency: 'ARS', period: 'monthly' as const }

  it('the version starting that month gets the new amount — no duplicate', async () => {
    const created = await createBudget({ ...base, amount: 50_000, startsOn: '2026-11' })
    const updated = await setBudgetAmountFrom({ ...base, amount: 60_000, startsOn: '2026-11' })
    expect(updated.id).toBe(created.id)
    expect(await listBudgets()).toEqual([expect.objectContaining({ id: created.id, amount: 60_000, startsOn: '2026-11' })])
  })

  it('from a later month, a new version starts there and the earlier one stays', async () => {
    await createBudget({ ...base, amount: 50_000, startsOn: '2026-11' })
    await setBudgetAmountFrom({ ...base, amount: 70_000, startsOn: '2027-01' })
    const budgets = (await listBudgets()).sort((a, b) => a.startsOn.localeCompare(b.startsOn))
    expect(budgets.map((b) => [b.startsOn, b.amount])).toEqual([
      ['2026-11', 50_000],
      ['2027-01', 70_000],
    ])
  })

  it('never touches the other period of the same category', async () => {
    await createBudget({ ...base, period: 'yearly', amount: 500_000, startsOn: '2026-11' })
    await setBudgetAmountFrom({ ...base, amount: 60_000, startsOn: '2026-11' })
    const budgets = await listBudgets()
    expect(budgets).toHaveLength(2)
    expect(budgets.find((b) => b.period === 'yearly')?.amount).toBe(500_000)
  })

  it('rejects a non-positive amount', async () => {
    await expect(setBudgetAmountFrom({ ...base, amount: 0, startsOn: '2026-11' })).rejects.toThrow(/mayor a cero/)
  })
})
