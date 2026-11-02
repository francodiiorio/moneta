import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createAccount } from '@/database/repositories/accounts.repo'
import { createBudget } from '@/database/repositories/budgets.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { createCreditCard, setCreditCardArchived } from '@/database/repositories/creditCards.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import { saveIncome } from '@/database/repositories/incomes.repo'
import { createRecurringPlan, setRecurringPlanPaused } from '@/database/repositories/recurringPlans.repo'
import { money } from '@/domain/money'
import { getMonthLeft, getOnboarding, getRecentMovements, getUpcoming, monthChange, savingsRate } from './service'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.budgets.clear(),
    db.categories.clear(),
    db.creditCards.clear(),
    db.expenses.clear(),
    db.incomes.clear(),
    db.recurringPlans.clear(),
    db.savingsHoldings.clear(),
  ])
})

describe('getOnboarding', () => {
  it('starts with every step pending and nothing loaded', async () => {
    const onboarding = await getOnboarding()
    expect(onboarding.hasData).toBe(false)
    expect(onboarding.steps.every((s) => !s.done)).toBe(true)
  })

  it('ticks each step off from what is really stored', async () => {
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const sueldo = await createCategory({ kind: 'income', name: 'Sueldo' })
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
    await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
    await saveExpense({ date: '2026-10-01', description: 'Super', categoryId: comida.id, amount: 100, currency: 'ARS', status: 'confirmed' })
    await saveIncome({ date: '2026-10-01', description: 'Sueldo', categoryId: sueldo.id, accountId: account.id, amount: 100, currency: 'ARS' })
    await createBudget({ categoryId: comida.id, amount: 100_00, currency: 'ARS', period: 'monthly', startsOn: '2026-10' })

    const onboarding = await getOnboarding()
    expect(onboarding.hasData).toBe(true)
    expect(Object.fromEntries(onboarding.steps.map((s) => [s.id, s.done]))).toEqual({
      account: true,
      card: true,
      expense: true,
      income: true,
      budget: true,
    })
  })

  it('anything loaded leaves the welcome — savings alone too, not just movements', async () => {
    const { createSavingsHolding } = await import('@/database/repositories/savingsHoldings.repo')
    await createSavingsHolding({ name: 'Plazo fijo', amount: 100, currency: 'ARS' })
    expect((await getOnboarding()).hasData).toBe(true)
  })
})

describe('getUpcoming', () => {
  it('lists projected installments and active recurring occurrences within the window, soonest first', async () => {
    const comida = await createCategory({ kind: 'expense', name: 'Comida', color: '#ff0000' })
    // A cuota already projected, one beyond the window, and one in the past.
    const cuota = { categoryId: comida.id, amount: 45_000_00, currency: 'ARS', status: 'projected' as const }
    await saveExpense({ ...cuota, date: '2026-11-05', description: 'Heladera (cuota 3/6)' })
    await saveExpense({ ...cuota, date: '2026-12-05', description: 'Heladera (cuota 4/6)' })
    await saveExpense({ ...cuota, date: '2026-10-05', description: 'Heladera (cuota 2/6)', status: 'confirmed' })
    // Monthly rent on the 1st; a paused plan never shows.
    const template = { description: 'Alquiler', categoryId: comida.id, amount: 280_000_00, currency: 'ARS' }
    await createRecurringPlan({ template, rule: { freq: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-01-01' } })
    const paused = await createRecurringPlan({
      template: { ...template, description: 'Gimnasio' },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 10, startDate: '2026-01-10' },
    })
    await setRecurringPlanPaused(paused.id, true)

    const upcoming = await getUpcoming('2026-10-24', 30)
    expect(upcoming.map((u) => [u.date, u.description, u.kind])).toEqual([
      ['2026-11-01', 'Alquiler', 'recurring'],
      ['2026-11-05', 'Heladera (cuota 3/6)', 'installment'],
    ])
    expect(upcoming[1]).toMatchObject({ amount: money(45_000_00, 'ARS'), categoryColor: '#ff0000' })
  })

  it('follows the plan’s materialization watermark, and its end', async () => {
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const template = { description: 'Netflix', categoryId: comida.id, amount: 10_00, currency: 'USD' }
    // Weekly, ending after two more occurrences in the window.
    const weekly = await createRecurringPlan({
      template: { ...template, description: 'Clase' },
      rule: { freq: 'weekly', interval: 1, weekday: 1, startDate: '2026-10-05', endDate: '2026-11-03' },
    })
    // Today's occurrence not materialized yet (the app stayed open past midnight).
    const daily = await createRecurringPlan({ template, rule: { freq: 'monthly', interval: 1, dayOfMonth: 24, startDate: '2026-01-24' } })
    await db.recurringPlans.update(daily.id, { lastMaterializedDate: '2026-09-24' })
    // Already materialized ahead (a merged backup from another device).
    const ahead = await createRecurringPlan({
      template: { ...template, description: 'Spotify' },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 30, startDate: '2026-01-30' },
    })
    await db.recurringPlans.update(ahead.id, { lastMaterializedDate: '2026-10-30' })

    const upcoming = await getUpcoming('2026-10-24', 31)
    expect(upcoming.map((u) => [u.date, u.description])).toEqual([
      ['2026-10-24', 'Netflix'],
      ['2026-10-26', 'Clase'],
      ['2026-11-02', 'Clase'],
      ['2026-11-24', 'Netflix'],
    ])
    expect(weekly.isPaused).toBe(false)
  })

  it('today’s occurrence is not upcoming: it was already materialized', async () => {
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const plan = await createRecurringPlan({
      template: { description: 'Netflix', categoryId: comida.id, amount: 10_00, currency: 'USD' },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 24, startDate: '2026-01-24' },
    })
    await db.recurringPlans.update(plan.id, { lastMaterializedDate: '2026-10-24' })
    expect(await getUpcoming('2026-10-24', 31)).toEqual([
      expect.objectContaining({ date: '2026-11-24', description: 'Netflix' }),
    ])
  })
})

describe('getRecentMovements', () => {
  it('newest confirmed movements of this month and the last, never projected ones', async () => {
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const base = { categoryId: comida.id, amount: 100, currency: 'ARS', status: 'confirmed' as const }
    await saveExpense({ ...base, date: '2026-09-20', description: 'Septiembre' })
    await saveExpense({ ...base, date: '2026-10-02', description: 'Octubre' })
    await saveExpense({ ...base, date: '2026-10-30', description: 'Cuota', status: 'projected' })
    await saveExpense({ ...base, date: '2026-08-31', description: 'Agosto' })

    // Loaded ahead with a later date: not recent yet.
    await saveExpense({ ...base, date: '2026-10-30', description: 'Futuro' })
    const recent = await getRecentMovements(5, '2026-10', '2026-10-24')
    expect(recent.map((r) => r.description)).toEqual(['Octubre', 'Septiembre'])
    expect(await getRecentMovements(1, '2026-10', '2026-10-24')).toHaveLength(1)
  })
})

describe('monthChange', () => {
  const ars = (amount: number) => ({ total: money(amount, 'ARS'), missingRateCount: 0 })
  it('the percent change month over month', () => {
    expect(monthChange(ars(1000), ars(1500))).toBe(50)
    expect(monthChange(ars(0), ars(1500))).toBeUndefined()
  })
  it('none when a month is partial or the currencies differ (base currency just changed)', () => {
    expect(monthChange({ ...ars(1000), missingRateCount: 1 }, ars(1500))).toBeUndefined()
    expect(monthChange(ars(1000), { total: money(1500, 'USD'), missingRateCount: 0 })).toBeUndefined()
  })
})

describe('savingsRate', () => {
  it('the share of ingresos left after gastos; negative when the month cost more; none without ingresos', () => {
    expect(savingsRate({ income: money(1000, 'ARS'), net: money(250, 'ARS') })).toBe(0.25)
    expect(savingsRate({ income: money(1000, 'ARS'), net: money(-500, 'ARS') })).toBe(-0.5)
    expect(savingsRate({ income: money(0, 'ARS'), net: money(-500, 'ARS') })).toBeUndefined()
  })
})

describe('getMonthLeft', () => {
  it('ingresos minus fixed, the card statements due this month and other gastos — card purchases only through their statement', async () => {
    const sueldo = await createCategory({ kind: 'income', name: 'Sueldo' })
    const salud = await createCategory({ kind: 'expense', name: 'Salud' })
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const account = await createAccount({ name: 'BBVA', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
    const visa = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })

    await saveIncome({ date: '2026-11-01', description: 'Sueldo', categoryId: sueldo.id, accountId: account.id, amount: 1_500_000_00, currency: 'ARS' })
    // Two fixed gastos: one already generated (Nov 1), one still to come (Nov 20).
    const galeno = await createRecurringPlan({
      template: { description: 'Galeno', categoryId: salud.id, amount: 295_000_00, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-11-01' },
    })
    await saveExpense({ date: '2026-11-01', description: 'Galeno', categoryId: salud.id, amount: 295_000_00, currency: 'ARS', status: 'confirmed', sourcePlanId: galeno.id, occurrenceIndex: 0 })
    await db.recurringPlans.update(galeno.id, { lastMaterializedDate: '2026-11-01' })
    await createRecurringPlan({
      template: { description: 'Gimnasio', categoryId: salud.id, amount: 50_000_00, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 20, startDate: '2026-11-20' },
    })
    // October's statement (closes Oct 22, due Nov 4) and a November card purchase (due in December).
    await saveExpense({ date: '2026-10-10', description: 'Super', categoryId: comida.id, amount: 400_000_00, currency: 'ARS', status: 'confirmed', cardId: visa.id })
    await saveExpense({ date: '2026-11-05', description: 'Rappi', categoryId: comida.id, amount: 20_000_00, currency: 'ARS', status: 'confirmed', cardId: visa.id })
    // A debit gasto.
    await saveExpense({ date: '2026-11-10', description: 'Verdulería', categoryId: comida.id, amount: 10_000_00, currency: 'ARS', status: 'confirmed', accountId: account.id })

    const result = await getMonthLeft('2026-11')
    expect(result).toMatchObject({
      income: money(1_500_000_00, 'ARS'),
      fixed: money(345_000_00, 'ARS'),
      cards: money(400_000_00, 'ARS'),
      other: money(10_000_00, 'ARS'),
      left: money(745_000_00, 'ARS'),
      hasIncome: true,
      missingRateCount: 0,
    })
    expect(result.cardItems).toEqual([{ cardId: visa.id, cardName: 'visa', dueDate: '2026-11-04', amount: money(400_000_00, 'ARS'), missingRate: false }])
  })

  it('a salary still to come counts; without any ingreso it says so', async () => {
    const sueldo = await createCategory({ kind: 'income', name: 'Sueldo' })
    const account = await createAccount({ name: 'BBVA', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
    expect((await getMonthLeft('2099-03')).hasIncome).toBe(false)
    await createRecurringPlan({
      kind: 'income',
      template: { description: 'Sueldo', categoryId: sueldo.id, amount: 1_000_000_00, currency: 'ARS', accountId: account.id },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2099-03-01' },
    })
    expect(await getMonthLeft('2099-03')).toMatchObject({ income: money(1_000_000_00, 'ARS'), hasIncome: true })
  })

  it("an archived card's statements still count — its cuotas are still due", async () => {
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const visa = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })
    await saveExpense({ date: '2099-01-22', description: 'Heladera (cuota 3/6)', categoryId: comida.id, amount: 100_000_00, currency: 'ARS', status: 'projected', cardId: visa.id })
    await setCreditCardArchived(visa.id, true)
    expect((await getMonthLeft('2099-02')).cards).toEqual(money(100_000_00, 'ARS'))
  })

  it("a card's fixed gastos still to be generated count in the statement they fall in", async () => {
    const servicios = await createCategory({ kind: 'expense', name: 'Servicios' })
    const visa = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })
    await createRecurringPlan({
      template: { description: 'Netflix', categoryId: servicios.id, amount: 15_000_00, currency: 'ARS', cardId: visa.id },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 15, startDate: '2099-01-15' },
    })
    // January's statement (Dec 23 – Jan 22, due Feb 4) has the Jan 15 one; it isn't a fixed gasto of its own.
    expect(await getMonthLeft('2099-02')).toMatchObject({ cards: money(15_000_00, 'ARS'), fixed: money(0, 'ARS') })
    // Only one per statement: February's (due in March) has Feb 15, not Jan 15 again.
    expect((await getMonthLeft('2099-03')).cards).toEqual(money(15_000_00, 'ARS'))
  })

  it('without a rate an amount is left out and flagged, and a salary in another currency is still an ingreso', async () => {
    const sueldo = await createCategory({ kind: 'income', name: 'Sueldo' })
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const account = await createAccount({ name: 'Dólares', type: 'bank', currency: 'USD', openingBalance: 0, openingDate: '2026-01-01' })
    const visa = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })
    await saveIncome({ date: '2099-02-01', description: 'Sueldo', categoryId: sueldo.id, accountId: account.id, amount: 2_000_00, currency: 'USD' })
    await saveExpense({ date: '2099-01-10', description: 'Steam', categoryId: comida.id, amount: 30_00, currency: 'USD', status: 'confirmed', cardId: visa.id })

    const result = await getMonthLeft('2099-02')
    expect(result).toMatchObject({ income: money(0, 'ARS'), cards: money(0, 'ARS'), hasIncome: true, missingRateCount: 2 })
    expect(result.cardItems).toMatchObject([{ cardId: visa.id, missingRate: true }])
  })
})
