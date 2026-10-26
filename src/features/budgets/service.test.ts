import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/database/db'
import { createBudget, deleteBudget } from '@/database/repositories/budgets.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { createExchangeRate } from '@/database/repositories/exchangeRates.repo'
import { createRecurringPlan, setRecurringPlanPaused } from '@/database/repositories/recurringPlans.repo'
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
    db.recurringPlans.clear(),
  ])
})

describe('getBudgetsWithProgress', () => {
  it('compares a monthly budget against the selected month\'s spend', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
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

  it('projected cuotas of the month show as committed, never as spent', async () => {
    const transport = await createCategory({ kind: 'expense', name: 'Transporte' })
    const other = await createCategory({ kind: 'expense', name: 'Otros' })
    await createBudget({ categoryId: transport.id, currency: 'ARS', period: 'monthly', amount: 370_000_00, startsOn: '2026-11' })
    await saveExpense({ date: '2026-11-03', description: 'Nafta', categoryId: transport.id, amount: 60_000_00, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-11-30', description: 'cubiertas (cuota 3/6)', categoryId: transport.id, amount: 88_040_00, currency: 'ARS', status: 'projected' })
    // Another month's, or another category's, isn't committed here.
    await saveExpense({ date: '2026-12-30', description: 'cubiertas (cuota 4/6)', categoryId: transport.id, amount: 88_040_00, currency: 'ARS', status: 'projected' })
    await saveExpense({ date: '2026-11-15', description: 'Cuota', categoryId: other.id, amount: 1_000_00, currency: 'ARS', status: 'projected' })

    const { items } = await getBudgetsWithProgress('2026-11')
    expect(items[0]!.progress).toMatchObject({
      actual: money(60_000_00, 'ARS'),
      committed: money(88_040_00, 'ARS'),
      free: money(221_960_00, 'ARS'),
      isOverBudget: false,
    })
  })

  it('carries the category\'s color/icon, omitting them when unset', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida', color: '#ef4444', icon: 'utensils' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: food.id, amount: 4_000, currency: 'ARS', status: 'confirmed' })

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]?.categoryColor).toBe('#ef4444')
    expect(items[0]?.categoryIcon).toBe('utensils')
  })

  it('omits categoryColor/categoryIcon for a category with neither set', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: food.id, amount: 4_000, currency: 'ARS', status: 'confirmed' })

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]?.categoryColor).toBeUndefined()
    expect(items[0]?.categoryIcon).toBeUndefined()
  })

  it('accumulates spend across the whole year for a yearly budget', async () => {
    const travel = await createCategory({ kind: 'expense', name: 'Viajes' })
    await createBudget({ categoryId: travel.id, currency: 'ARS', period: 'yearly', amount: 100_000, startsOn: '2026-01' })
    await saveExpense({ date: '2026-02-01', description: 'Vuelo', categoryId: travel.id, amount: 30_000, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-07-01', description: 'Hotel', categoryId: travel.id, amount: 20_000, currency: 'ARS', status: 'confirmed' })

    const { items } = await getBudgetsWithProgress('2026-08') // browsed month shouldn't matter for yearly
    expect(items).toHaveLength(1)
    expect(items[0]!.progress.actual).toEqual(money(50_000, 'ARS')) // 30000 + 20000
    expect(items[0]!.progress.percentUsed).toBe(50)
  })

  it('shows a budgeted category with zero actual spend as 0% used', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]!.progress.actual).toEqual(money(0, 'ARS'))
    expect(items[0]!.progress.percentUsed).toBe(0)
  })

  it('uses the budget version in effect for the evaluated month, not always the latest', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 20_000, startsOn: '2026-08' })

    const july = await getBudgetsWithProgress('2026-07')
    expect(july.items[0]!.progress.budget).toEqual(money(10_000, 'ARS'))

    const august = await getBudgetsWithProgress('2026-08')
    expect(august.items[0]!.progress.budget).toEqual(money(20_000, 'ARS'))
  })

  it('keeps resolving correctly after deleting the middle version of three', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
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
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'USD', period: 'monthly', amount: 100, startsOn: '2026-01' })
    await createExchangeRate({ date: '2026-01-01', from: 'USD', to: 'ARS', rate: 1000 })

    const { items, missingRateCount } = await getBudgetsWithProgress('2026-08') // baseCurrency defaults to ARS
    expect(items[0]!.progress.budget).toEqual(money(100_000, 'ARS')) // 100 USD * 1000
    expect(missingRateCount).toBe(0)
  })

  it('passes through missingRateCount when actual spend cannot be converted', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    // no exchange rate loaded — this expense can't be converted to ARS
    await saveExpense({ date: '2026-08-05', description: 'Compra', categoryId: food.id, amount: 10, currency: 'USD', status: 'confirmed' })

    const { missingRateCount } = await getBudgetsWithProgress('2026-08')
    expect(missingRateCount).toBe(1)
  })

  it('a yearly budget counts the cuotas still to come this year as committed, not next year’s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-26T12:00:00'))
    try {
      const travel = await createCategory({ kind: 'expense', name: 'Viajes' })
      await createBudget({ categoryId: travel.id, currency: 'ARS', period: 'yearly', amount: 1_000_000, startsOn: '2026-01' })
      await saveExpense({ date: '2026-03-01', description: 'Vuelo', categoryId: travel.id, amount: 300_000, currency: 'ARS', status: 'confirmed' })
      await saveExpense({ date: '2026-11-10', description: 'Hotel (cuota 2/3)', categoryId: travel.id, amount: 100_000, currency: 'ARS', status: 'projected' })
      await saveExpense({ date: '2026-12-10', description: 'Hotel (cuota 3/3)', categoryId: travel.id, amount: 100_000, currency: 'ARS', status: 'projected' })
      await saveExpense({ date: '2027-01-10', description: 'Otro (cuota 2/2)', categoryId: travel.id, amount: 50_000, currency: 'ARS', status: 'projected' })

      const { items } = await getBudgetsWithProgress('2026-10')
      expect(items[0]!.progress).toMatchObject({
        actual: money(300_000, 'ARS'),
        committed: money(200_000, 'ARS'),
        free: money(500_000, 'ARS'),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a projected cuota in another currency converts at the latest rate, or counts as missing without one', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 100_000, startsOn: '2026-01' })
    await saveExpense({ date: '2026-08-20', description: 'Suscripción (cuota 2/3)', categoryId: food.id, amount: 10, currency: 'USD', status: 'projected' })

    const withoutRate = await getBudgetsWithProgress('2026-08')
    expect(withoutRate.missingRateCount).toBe(1)
    expect(withoutRate.items[0]!.progress.committed).toEqual(money(0, 'ARS'))

    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 })
    const withRate = await getBudgetsWithProgress('2026-08')
    expect(withRate.missingRateCount).toBe(0)
    expect(withRate.items[0]!.progress.committed).toEqual(money(10_000, 'ARS'))
  })

  it('a recurring gasto due later in the month counts as committed until it’s generated', async () => {
    const health = await createCategory({ kind: 'expense', name: 'Salud' })
    await createBudget({ categoryId: health.id, currency: 'ARS', period: 'monthly', amount: 410_000_00, startsOn: '2026-11' })
    const plan = await createRecurringPlan({
      template: { description: 'galeno', categoryId: health.id, amount: 295_421_51, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-11-01' },
    })

    const [item] = (await getBudgetsWithProgress('2026-11')).items
    expect(item!.progress).toMatchObject({ actual: money(0, 'ARS'), committed: money(295_421_51, 'ARS') })

    // Generated on its date: spent now, no longer committed.
    await db.recurringPlans.update(plan.id, { lastMaterializedDate: '2026-11-01' })
    await saveExpense({ date: '2026-11-01', description: 'galeno', categoryId: health.id, amount: 295_421_51, currency: 'ARS', status: 'confirmed', sourcePlanId: plan.id, occurrenceIndex: 0 })
    const [after] = (await getBudgetsWithProgress('2026-11')).items
    expect(after!.progress).toMatchObject({ actual: money(295_421_51, 'ARS'), committed: money(0, 'ARS') })

    // A paused plan commits nothing.
    await setRecurringPlanPaused(plan.id, true)
    const [december] = (await getBudgetsWithProgress('2026-12')).items
    expect(december!.progress.committed).toEqual(money(0, 'ARS'))
  })
})
