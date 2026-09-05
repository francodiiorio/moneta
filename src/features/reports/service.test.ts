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
import { getExpenseByCategory, getMonthlyReport, getMonthSummary, getNetWorthHistory } from './service'

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
  ])
})

describe('getMonthSummary', () => {
  it('sums expenses in a single currency', async () => {
    const foodCat = await createCategory({ name: 'Comida' })

    await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: foodCat.id, amount: 1000, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-08-06', description: 'Almacén', categoryId: foodCat.id, amount: 500, currency: 'ARS', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(1500, 'ARS'))
    expect(summary.missingRateCount).toBe(0)
  })

  it('converts cross-currency expenses to the base currency using the rate at the expense date', async () => {
    const category = await createCategory({ name: 'Viajes' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 })

    await saveExpense({ date: '2026-08-15', description: 'Hotel', categoryId: category.id, amount: 100, currency: 'USD', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08') // baseCurrency defaults to ARS
    expect(summary.expense).toEqual(money(100_000, 'ARS')) // 100 USD * 1000
    expect(summary.missingRateCount).toBe(0)
  })

  it("prefers settings.rateProfile's rate over an untagged one for the same pair/date", async () => {
    const category = await createCategory({ name: 'Viajes' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 }) // untagged
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1500, profile: 'blue' })
    await updateSettings({ rateProfile: 'blue' })

    await saveExpense({ date: '2026-08-15', description: 'Hotel', categoryId: category.id, amount: 100, currency: 'USD', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(150_000, 'ARS')) // 100 USD * 1500 (blue), not * 1000
  })

  it('counts a missing rate instead of throwing, and does not let it affect other totals', async () => {
    const category = await createCategory({ name: 'Varios' })
    // no exchange rate loaded at all

    await saveExpense({ date: '2026-08-05', description: 'Compra ARS', categoryId: category.id, amount: 2000, currency: 'ARS', status: 'confirmed' })
    await saveExpense({ date: '2026-08-06', description: 'Compra USD', categoryId: category.id, amount: 50, currency: 'USD', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(2000, 'ARS')) // only the ARS one counted
    expect(summary.missingRateCount).toBe(1)
  })

  it('excludes projected expenses, only counting confirmed ones', async () => {
    const category = await createCategory({ name: 'Comida' })

    await saveExpense({ date: '2026-08-05', description: 'Cuota futura', categoryId: category.id, amount: 9999, currency: 'ARS', status: 'projected' })
    await saveExpense({ date: '2026-08-06', description: 'Real', categoryId: category.id, amount: 300, currency: 'ARS', status: 'confirmed' })

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(300, 'ARS')) // the projected 9999 must not appear
  })
})

describe('getExpenseByCategory', () => {
  it('groups and sorts by total amount descending', async () => {
    const food = await createCategory({ name: 'Comida' })
    const transport = await createCategory({ name: 'Transporte' })

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
    // but the fallback should still hold if that ever changes).
    await saveExpense({ date: '2026-08-01', description: 'Sin tasa', categoryId: 'missing-category', amount: 10, currency: 'USD', status: 'confirmed' })

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
      const foodCat = await createCategory({ name: 'Comida' })
      const funCat = await createCategory({ name: 'Ocio' })

      await saveExpense({ date: '2026-08-05', description: 'Super', categoryId: foodCat.id, amount: 3000, currency: 'ARS', status: 'confirmed' })
      await saveExpense({ date: '2026-08-06', description: 'Cine', categoryId: funCat.id, amount: 1000, currency: 'ARS', status: 'confirmed' })

      const report = await getMonthlyReport('2026-08')
      expect(report.isCurrentMonth).toBe(false)
      expect(report.coverageEnd).toBe('2026-08-31')
      expect(report.summary.expense).toEqual(money(4000, 'ARS'))
      expect(report.categories.map((c) => [c.categoryName, c.amount.amount, c.share])).toEqual([
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
      expect(report.netWorth?.total).toEqual(money(50_000, 'ARS')) // 100 USD * 500
    } finally {
      vi.useRealTimers()
    }
  })

  it('omits the net worth section when nothing is tracked', async () => {
    const report = await getMonthlyReport('2026-08')
    expect(report.netWorth).toBeUndefined()
    expect(report.summary.expense.amount).toBe(0)
  })

  it('includes the net worth section for a savings-only user', async () => {
    await createSavingsHolding({ name: 'Efectivo', currency: 'ARS', amount: 50_000 })

    const report = await getMonthlyReport('2026-08')
    expect(report.netWorth).toBeDefined()
    expect(report.netWorth?.byBucket.savings).toEqual(money(50_000, 'ARS'))
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
    const category = await createCategory({ name: 'Viajes' })
    // No exchange rate loaded at all — the USD expense and the USD savings
    // each miss independently; summary's own miss and the valuation's own
    // miss must not be summed as if they were the same item twice.
    await saveExpense({ date: '2026-08-05', description: 'Vuelo', categoryId: category.id, amount: 100, currency: 'USD', status: 'confirmed' })
    await createSavingsHolding({ name: 'Caja de ahorro', currency: 'USD', amount: 100 })

    const report = await getMonthlyReport('2026-08')
    expect(report.missingRateCount).toBe(2) // one from summary's expense, one from valuing the USD saving
  })
})
