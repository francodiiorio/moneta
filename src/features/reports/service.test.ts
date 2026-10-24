import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/database/db'
import { createCategory } from '@/database/repositories/categories.repo'
import { createExchangeRate } from '@/database/repositories/exchangeRates.repo'
import { createAssetPrice } from '@/database/repositories/assetPrices.repo'
import { createInvestmentAsset, createInvestmentHolding } from '@/database/repositories/investments.repo'
import { createSavingsHolding } from '@/database/repositories/savingsHoldings.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import { updateSettings } from '@/database/repositories/settings.repo'
import { QUANTITY_SCALE } from '@/domain/decimal'
import { money } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { createAccount } from '@/database/repositories/accounts.repo'
import { saveIncome } from '@/database/repositories/incomes.repo'
import {
  getExpenseByCategory,
  getIncomeByCategory,
  getMonthFlowHistory,
  getMonthlyReport,
  getMonthSummary,
  getNetWorthHistory,
} from './service'

afterEach(async () => {
  await Promise.all([
    db.categories.clear(),
    db.expenses.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
    db.incomes.clear(),
    db.accounts.clear(),
  ])
})

describe('getMonthSummary', () => {
  it('sums expenses in a single currency', async () => {
    const foodCat = await createCategory({ kind: 'expense', name: 'Comida' })

    await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: foodCat.id, amount: 1000, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-08-06', description: 'Almacén', categoryId: foodCat.id, amount: 500, currency: 'ARS', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(1500, 'ARS'))
    expect(summary.missingRateCount).toBe(0)
  })

  it('converts cross-currency expenses to the base currency using the rate at the expense date', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Viajes' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 })

    await saveExpense({ date: '2026-08-15', description: 'Hotel', categoryId: category.id, amount: 100, currency: 'USD', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08') // baseCurrency defaults to ARS
    expect(summary.expense).toEqual(money(100_000, 'ARS')) // 100 USD * 1000
    expect(summary.missingRateCount).toBe(0)
  })

  it("prefers settings.rateProfile's rate over an untagged one for the same pair/date", async () => {
    const category = await createCategory({ kind: 'expense', name: 'Viajes' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 }) // untagged
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1500, profile: 'blue' })
    await updateSettings({ rateProfile: 'blue' })

    await saveExpense({ date: '2026-08-15', description: 'Hotel', categoryId: category.id, amount: 100, currency: 'USD', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(150_000, 'ARS')) // 100 USD * 1500 (blue), not * 1000
  })

  it('counts a missing rate instead of throwing, and does not let it affect other totals', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Varios' })
    // no exchange rate loaded at all

    await saveExpense({ date: '2026-08-05', description: 'Compra ARS', categoryId: category.id, amount: 2000, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-08-06', description: 'Compra USD', categoryId: category.id, amount: 50, currency: 'USD', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(2000, 'ARS')) // only the ARS one counted
    expect(summary.missingRateCount).toBe(1)
  })

  it('excludes projected expenses, only counting confirmed ones', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })

    await saveExpense({ date: '2026-08-05', description: 'Cuota futura', categoryId: category.id, amount: 9999, currency: 'ARS', status: 'projected' })
    await saveExpense({ date: '2026-08-06', description: 'Real', categoryId: category.id, amount: 300, currency: 'ARS', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(300, 'ARS')) // the projected 9999 must not appear
  })
})

describe('getMonthFlowHistory', () => {
  it('anchors the trailing window to anchorMonth instead of always the current month', async () => {
    const foodCat = await createCategory({ kind: 'expense', name: 'Comida' })
    await saveExpense({ date: '2025-01-10', description: 'Super', categoryId: foodCat.id, amount: 1000, currency: 'ARS', status: 'confirmed' })
    // Outside the 3-month window ending at the anchor (2024-11..2025-01) —
    // must not leak in just because it's a real expense elsewhere.
    await saveExpense({ date: '2026-08-05', description: 'Otro mes', categoryId: foodCat.id, amount: 9999, currency: 'ARS', status: 'confirmed' })

    const history = await getMonthFlowHistory(3, '2025-01')

    expect(history.points.map((p) => p.month)).toEqual(['2024-11', '2024-12', '2025-01'])
    expect(history.points[history.points.length - 1]!.expense).toEqual(money(1000, 'ARS'))
  })
})

describe('getExpenseByCategory', () => {
  it('groups and sorts by total amount descending', async () => {
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
    const transport = await createCategory({ kind: 'expense', name: 'Transporte' })

    await saveExpense({ date: '2026-08-01', description: 'a', categoryId: food.id, amount: 1000, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-08-02', description: 'b', categoryId: food.id, amount: 500, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-08-03', description: 'c', categoryId: transport.id, amount: 200, currency: 'ARS', status: 'confirmed' })

    const { items, missingRateCount } = await getExpenseByCategory('2026-08')
    expect(items).toEqual([
      { categoryId: food.id, categoryName: 'Comida', amount: money(1500, 'ARS') },
      { categoryId: transport.id, categoryName: 'Transporte', amount: money(200, 'ARS') },
    ])
    expect(missingRateCount).toBe(0)
  })

  it('counts a missing rate and falls back to a placeholder name for a deleted category', async () => {
    // No category record exists for this id — simulates a dangling
    // reference (categories today can only be archived, never hard-deleted,
    // but the fallback should still hold if that ever changes). Written
    // straight to Dexie: saveExpense itself rightly refuses an unknown
    // category, so the only way to get here is data that predates it.
    const now = new Date().toISOString()
    await db.expenses.add({
      id: 'dangling',
      date: '2026-08-01',
      description: 'Sin tasa',
      categoryId: 'missing-category',
      amount: 10,
      currency: 'USD',
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    })

    const { items, missingRateCount } = await getExpenseByCategory('2026-08')
    expect(missingRateCount).toBe(1)
    expect(items).toEqual([])

    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 })
    const afterRate = await getExpenseByCategory('2026-08')
    expect(afterRate.items).toEqual([
      { categoryId: 'missing-category', categoryName: 'Categoría eliminada', amount: money(10_000, 'ARS') },
    ])
  })
})

describe('getNetWorthHistory', () => {
  it('includes a savings holding\'s current amount in every historical point', async () => {
    await createSavingsHolding({ name: 'Efectivo', currency: 'ARS', amount: 150_000 })

    // Savings has no history of its own — see docs/DECISIONS.md — so
    // "today's amount" is what every past point uses too.
    const { points, missingRateCount } = await getNetWorthHistory(3)
    expect(missingRateCount).toBe(0)
    expect(points.every((p) => p.netWorth.amount === 150_000)).toBe(true)
  })

  it('counts a savings holding it cannot convert instead of throwing', async () => {
    await createSavingsHolding({ name: 'Caja de ahorro', currency: 'USD', amount: 100 })
    // no exchange rate loaded at all

    const { points, missingRateCount } = await getNetWorthHistory(2)
    expect(points.every((p) => p.netWorth.amount === 0)).toBe(true)
    expect(missingRateCount).toBe(2) // one miss per point
  })

  it('revalues an investment position at each month\'s own historical price, not the latest one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    try {
      await updateSettings({ baseCurrency: 'ARS' })
      const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'ARS', priceMode: 'manual' })
      await createInvestmentHolding({ assetId: asset.id, quantity: 2 * QUANTITY_SCALE })
      // Price changed mid-window: 1000 until mid-July, 1500 from then on.
      await createAssetPrice({ assetId: asset.id, price: 1000, currency: 'ARS', date: '2026-01-01', source: 'manual' })
      await createAssetPrice({ assetId: asset.id, price: 1500, currency: 'ARS', date: '2026-07-15', source: 'manual' })

      const { points, missingRateCount, missingPriceCount } = await getNetWorthHistory(3) // Jun, Jul, Aug(today)
      expect(missingRateCount).toBe(0)
      expect(missingPriceCount).toBe(0)
      expect(points.map((p) => [p.month, p.netWorth.amount])).toEqual([
        ['2026-06', 2_000], // 2 units * 1000 (price valid at 2026-06-30)
        ['2026-07', 3_000], // 2 units * 1500 (price changed 2026-07-15, valid at 2026-07-31)
        ['2026-08', 3_000], // 2 units * 1500 (still valid as of "today" 2026-08-23)
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts an investment position with no price loaded instead of throwing', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'ARS', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 2 * QUANTITY_SCALE })
    // No AssetPrice created at all.

    const { points, missingPriceCount } = await getNetWorthHistory(2)
    expect(points.every((p) => p.netWorth.amount === 0)).toBe(true)
    expect(missingPriceCount).toBe(2) // one miss per point
  })
})

describe('getMonthlyReport', () => {
  it('composes the summary and expense-by-category for a closed month', async () => {
    // Fake "today" so the target month is unambiguously in the past,
    // regardless of the real calendar date the test suite runs on.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
    try {
      const foodCat = await createCategory({ kind: 'expense', name: 'Comida' })
      const funCat = await createCategory({ kind: 'expense', name: 'Ocio' })

      await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: foodCat.id, amount: 3000, currency: 'ARS', status: 'confirmed' })
      await saveExpense({ date: '2026-08-06', description: 'Cine', categoryId: funCat.id, amount: 1000, currency: 'ARS', status: 'confirmed' })

      const report = await getMonthlyReport('2026-08')
      expect(report.isCurrentMonth).toBe(false)
      expect(report.coverageEnd).toBe('2026-08-31')
      expect(report.summary.expense).toEqual(money(4000, 'ARS'))
      expect(report.expenseCategories.map((c) => [c.categoryName, c.amount.amount, c.share])).toEqual([
        ['Comida', 3000, 0.75],
        ['Ocio', 1000, 0.25],
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('values net worth as of today for a month in progress, not month-end', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    try {
      await updateSettings({ baseCurrency: 'ARS' })
      await createSavingsHolding({ name: 'Caja de ahorro', currency: 'USD', amount: 100 })
      await createExchangeRate({ date: '2026-01-01', from: 'USD', to: 'ARS', rate: 500 })
      // Dated after "today" but still inside August — must not be used.
      await createExchangeRate({ date: '2026-08-30', from: 'USD', to: 'ARS', rate: 1000 })

      const report = await getMonthlyReport('2026-08')
      expect(report.isCurrentMonth).toBe(true)
      expect(report.coverageEnd).toBe(todayStamp())
      expect(report.netWorth?.ars.total).toEqual(money(50_000, 'ARS')) // 100 USD * 500
      expect(report.netWorth?.usd.total).toEqual(money(100, 'USD'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('omits the net worth section when nothing is tracked', async () => {
    const report = await getMonthlyReport('2026-08')
    expect(report.netWorth).toBeUndefined()
    expect(report.summary.expense.amount).toBe(0)
  })

  it('includes the net worth section, in both ARS and USD, for a savings-only user', async () => {
    await createSavingsHolding({ name: 'Efectivo', currency: 'ARS', amount: 50_000 })
    await createExchangeRate({ date: '2026-01-01', from: 'USD', to: 'ARS', rate: 500 })

    const report = await getMonthlyReport('2026-08')
    expect(report.netWorth).toBeDefined()
    expect(report.netWorth?.ars.byBucket.savings).toEqual(money(50_000, 'ARS'))
    expect(report.netWorth?.usd.byBucket.savings).toEqual(money(100, 'USD'))
  })

  it('degrades a future month to an empty report instead of crashing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    try {
      const report = await getMonthlyReport('2026-12')
      expect(report.coverageEnd).toBe(todayStamp())
      expect(report.summary.expense.amount).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not double-count a missing rate between the summary and the valuation', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Viajes' })
    // No exchange rate loaded at all — the USD expense and the USD savings
    // each miss independently; summary's own miss and the valuation's own
    // miss must not be summed as if they were the same item twice.
    await saveExpense({ date: '2026-08-05', description: 'Vuelo', categoryId: category.id, amount: 100, currency: 'USD', status: 'confirmed' })
    await createSavingsHolding({ name: 'Caja de ahorro', currency: 'USD', amount: 100 })

    const report = await getMonthlyReport('2026-08')
    expect(report.missingRateCount).toBe(2) // one from summary's expense, one from valuing the USD saving
  })
})

describe('Reportes con cuentas (Etapa 8)', () => {
  afterEach(async () => {
    await Promise.all([db.accounts.clear(), db.incomes.clear()])
  })

  async function withToday(iso: string, run: () => Promise<void>): Promise<void> {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
    try {
      await run()
    } finally {
      vi.useRealTimers()
    }
  }

  async function seedAccount() {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const { saveIncome } = await import('@/database/repositories/incomes.repo')
    const account = await createAccount({
      name: 'Galicia',
      type: 'bank',
      currency: 'ARS',
      openingBalance: 1_000,
      openingDate: '2026-07-10',
    })
    const category = await createCategory({ kind: 'income', name: 'Sueldo' })
    await saveIncome({
      date: '2026-08-05',
      description: 'Sueldo',
      categoryId: category.id,
      accountId: account.id,
      amount: 500,
      currency: 'ARS',
    })
  }

  it('getNetWorthHistory uses the real account balance per month, and nothing before it opened', async () => {
    await withToday('2026-08-23T12:00:00Z', async () => {
      await updateSettings({ baseCurrency: 'ARS' })
      await seedAccount()
      const { points } = await getNetWorthHistory(3)
      expect(points.map((p) => [p.month, p.netWorth.amount])).toEqual([
        ['2026-06', 0],
        ['2026-07', 1_000],
        ['2026-08', 1_500],
      ])
    })
  })

  it('getMonthlyReport has a patrimonio section with only accounts, in both currencies', async () => {
    await withToday('2026-08-23T12:00:00Z', async () => {
      await updateSettings({ baseCurrency: 'ARS' })
      await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 })
      await seedAccount()
      const report = await getMonthlyReport('2026-08')
      expect(report.netWorth?.ars.byBucket.accounts).toEqual(money(1_500, 'ARS'))
      expect(report.netWorth?.usd.byBucket.accounts).toEqual(money(2, 'USD')) // 15,00 ARS / 1000 = 0,015 USD → 0,02
      expect(report.netWorth?.ars.total).toEqual(money(1_500, 'ARS'))
    })
  })
})

describe('ingresos y balance neto (Etapa 8)', () => {
  async function seed() {
    await updateSettings({ baseCurrency: 'ARS' })
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const sueldo = await createCategory({ kind: 'income', name: 'Sueldo' })
    const freelance = await createCategory({ kind: 'income', name: 'Freelance' })
    const base = { type: 'bank' as const, openingBalance: 0, openingDate: '2026-01-01' }
    const pesos = await createAccount({ ...base, name: 'Galicia', currency: 'ARS' })
    const dolares = await createAccount({ ...base, name: 'Caja USD', currency: 'USD' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 })
    await saveIncome({ date: '2026-08-01', description: 'Sueldo', categoryId: sueldo.id, accountId: pesos.id, amount: 500_000_00, currency: 'ARS' })
    await saveIncome({ date: '2026-08-15', description: 'Cliente', categoryId: freelance.id, accountId: dolares.id, amount: 100_00, currency: 'USD' })
    await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: comida.id, amount: 200_000_00, currency: 'ARS', status: 'confirmed' })
    // Projected gastos never count, same as before.
    await saveExpense({ date: '2026-08-20', description: 'Cuota', categoryId: comida.id, amount: 50_000_00, currency: 'ARS', status: 'projected' })
    return { comida, sueldo, pesos }
  }

  it('the month summary has ingresos (converted) and the balance neto', async () => {
    await seed()
    expect(await getMonthSummary('2026-08')).toEqual({
      expense: money(200_000_00, 'ARS'),
      income: money(600_000_00, 'ARS'),
      net: money(400_000_00, 'ARS'),
      missingRateCount: 0,
      expenseMissingRateCount: 0,
    })
  })

  it('the balance goes negative when the month cost more than came in', async () => {
    const { comida } = await seed()
    await saveExpense({ date: '2026-08-06', description: 'Auto', categoryId: comida.id, amount: 500_000_00, currency: 'ARS', status: 'confirmed' })
    expect((await getMonthSummary('2026-08')).net).toEqual(money(-100_000_00, 'ARS'))
  })

  it('an ingreso without a rate is counted as missing — not as a gasto miss — and marks the month partial', async () => {
    await seed()
    await db.exchangeRates.clear()
    const summary = await getMonthSummary('2026-08')
    expect(summary.income).toEqual(money(500_000_00, 'ARS'))
    expect(summary.missingRateCount).toBe(1)
    expect(summary.expenseMissingRateCount).toBe(0)
    expect((await getMonthFlowHistory(1, '2026-08')).points[0]?.partial).toBe(true)
    expect((await getIncomeByCategory('2026-08')).missingRateCount).toBe(1)
  })

  it('ingresos count by their own month: the last day is in, the next month’s first day is not', async () => {
    const { sueldo, pesos } = await seed()
    await saveIncome({ date: '2026-08-31', description: 'Bono', categoryId: sueldo.id, accountId: pesos.id, amount: 1_00, currency: 'ARS' })
    await saveIncome({ date: '2026-09-01', description: 'Sueldo sept', categoryId: sueldo.id, accountId: pesos.id, amount: 7_00, currency: 'ARS' })
    expect((await getMonthSummary('2026-08')).income).toEqual(money(600_001_00, 'ARS'))
    expect((await getMonthSummary('2026-09')).income).toEqual(money(7_00, 'ARS'))
  })

  it('ingresos never show up in gastos by category (what budgets read)', async () => {
    await seed()
    expect((await getExpenseByCategory('2026-08')).items.map((i) => i.categoryName)).toEqual(['Comida'])
  })

  it('ingresos by category, biggest first', async () => {
    await seed()
    const { items } = await getIncomeByCategory('2026-08')
    expect(items.map((i) => [i.categoryName, i.amount])).toEqual([
      ['Sueldo', money(500_000_00, 'ARS')],
      ['Freelance', money(100_000_00, 'ARS')],
    ])
  })

  it('the history carries ingresos and balance per month', async () => {
    await seed()
    const history = await getMonthFlowHistory(2, '2026-08')
    expect(history.points.at(-1)).toMatchObject({ month: '2026-08', income: money(600_000_00, 'ARS'), net: money(400_000_00, 'ARS'), partial: false })
    expect(history.points[0]).toMatchObject({ month: '2026-07', income: money(0, 'ARS'), net: money(0, 'ARS') })
  })

  it('the monthly report breaks ingresos down by category with their share', async () => {
    await seed()
    const report = await getMonthlyReport('2026-08')
    expect(report.summary.net).toEqual(money(400_000_00, 'ARS'))
    expect(report.incomeCategories.map((r) => [r.categoryName, r.share])).toEqual([
      ['Sueldo', 500 / 600],
      ['Freelance', 100 / 600],
    ])
  })

  it('in the monthly report, a USD ingreso without a rate is one miss in the summary and one valuing its account', async () => {
    await seed()
    await db.exchangeRates.clear()
    const report = await getMonthlyReport('2026-08')
    // Summary: the ingreso. ARS valuation: the USD account's balance. (The
    // USD valuation of the peso account is a third, independent miss.)
    expect(report.summary.missingRateCount).toBe(1)
    expect(report.missingRateCount).toBe(3)
  })
})
