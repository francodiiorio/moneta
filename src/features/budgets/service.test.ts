import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createBudget, deleteBudget } from '@/database/repositories/budgets.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { createExchangeRate } from '@/database/repositories/exchangeRates.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import { money } from '@/domain/money'
import { getBudgetsWithProgress } from './service'

afterEach(async () => {
  await Promise.all([
    db.categories.clear(),
    db.expenses.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.budgets.clear(),
  ])
})

describe('getBudgetsWithProgress', () => {
  it('compares a monthly budget against the selected month\'s spend', async () => {
    const food = await createCategory({ name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: food.id, amount: 4_000, currency: 'ARS', status: 'confirmed' })

    const { items, missingRateCount } = await getBudgetsWithProgress('2026-08')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ categoryId: food.id, categoryName: 'Comida', period: 'monthly' })
    expect(items[0]!.progress.budget).toEqual(money(10_000, 'ARS'))
    expect(items[0]!.progress.actual).toEqual(money(4_000, 'ARS'))
    expect(items[0]!.progress.percentUsed).toBe(40)
    expect(missingRateCount).toBe(0)
  })

  it('carries the category\'s color/icon, omitting them when unset', async () => {
    const food = await createCategory({ name: 'Comida', color: '#ef4444', icon: 'utensils' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: food.id, amount: 4_000, currency: 'ARS', status: 'confirmed' })

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]?.categoryColor).toBe('#ef4444')
    expect(items[0]?.categoryIcon).toBe('utensils')
  })

  it('omits categoryColor/categoryIcon for a category with neither set', async () => {
    const food = await createCategory({ name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: food.id, amount: 4_000, currency: 'ARS', status: 'confirmed' })

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]?.categoryColor).toBeUndefined()
    expect(items[0]?.categoryIcon).toBeUndefined()
  })

  it('accumulates spend across the whole year for a yearly budget', async () => {
    const travel = await createCategory({ name: 'Viajes' })
    await createBudget({ categoryId: travel.id, currency: 'ARS', period: 'yearly', amount: 100_000, startsOn: '2026-01' })
    await saveExpense({ date: '2026-02-01', description: 'Vuelo', categoryId: travel.id, amount: 30_000, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-07-01', description: 'Hotel', categoryId: travel.id, amount: 20_000, currency: 'ARS', status: 'confirmed' })

    const { items } = await getBudgetsWithProgress('2026-08') // browsed month shouldn't matter for yearly
    expect(items).toHaveLength(1)
    expect(items[0]!.progress.actual).toEqual(money(50_000, 'ARS')) // 30000 + 20000
    expect(items[0]!.progress.percentUsed).toBe(50)
  })

  it('shows a budgeted category with zero actual spend as 0% used', async () => {
    const food = await createCategory({ name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]!.progress.actual).toEqual(money(0, 'ARS'))
    expect(items[0]!.progress.percentUsed).toBe(0)
  })

  it('uses the budget version in effect for the evaluated month, not always the latest', async () => {
    const food = await createCategory({ name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 20_000, startsOn: '2026-08' })

    const july = await getBudgetsWithProgress('2026-07')
    expect(july.items[0]!.progress.budget).toEqual(money(10_000, 'ARS'))

    const august = await getBudgetsWithProgress('2026-08')
    expect(august.items[0]!.progress.budget).toEqual(money(20_000, 'ARS'))
  })

  it('keeps resolving correctly after deleting the middle version of three', async () => {
    const food = await createCategory({ name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    const middle = await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 20_000, startsOn: '2026-06' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 30_000, startsOn: '2026-09' })

    await deleteBudget(middle.id)

    const may = await getBudgetsWithProgress('2026-05') // before the deleted version's startsOn
    expect(may.items[0]!.progress.budget).toEqual(money(10_000, 'ARS'))

    const august = await getBudgetsWithProgress('2026-08') // used to resolve to the deleted middle version
    expect(august.items[0]!.progress.budget).toEqual(money(10_000, 'ARS')) // falls back to the oldest still-effective version

    const october = await getBudgetsWithProgress('2026-10') // after the newest version's startsOn
    expect(october.items[0]!.progress.budget).toEqual(money(30_000, 'ARS'))
  })

  it('converts a budget stored in a currency that is no longer the base currency', async () => {
    const food = await createCategory({ name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'USD', period: 'monthly', amount: 100, startsOn: '2026-01' })
    await createExchangeRate({ date: '2026-01-01', from: 'USD', to: 'ARS', rate: 1000 })

    const { items, missingRateCount } = await getBudgetsWithProgress('2026-08') // baseCurrency defaults to ARS
    expect(items[0]!.progress.budget).toEqual(money(100_000, 'ARS')) // 100 USD * 1000
    expect(missingRateCount).toBe(0)
  })

  it('passes through missingRateCount when actual spend cannot be converted', async () => {
    const food = await createCategory({ name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    // no exchange rate loaded — this expense can't be converted to ARS
    await saveExpense({ date: '2026-08-05', description: 'Compra', categoryId: food.id, amount: 10, currency: 'USD', status: 'confirmed' })

    const { missingRateCount } = await getBudgetsWithProgress('2026-08')
    expect(missingRateCount).toBe(1)
  })
})
