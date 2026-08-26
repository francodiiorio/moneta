import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/database/db'
import { createAccount } from '@/database/repositories/accounts.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { createExchangeRate } from '@/database/repositories/exchangeRates.repo'
import { createAssetPrice } from '@/database/repositories/assetPrices.repo'
import { createInvestmentAsset, createInvestmentHolding } from '@/database/repositories/investments.repo'
import { createSavingsHolding } from '@/database/repositories/savingsHoldings.repo'
import { saveTransaction } from '@/database/repositories/transactions.repo'
import { updateSettings } from '@/database/repositories/settings.repo'
import { buildExpense, buildIncome, buildTransfer } from '@/domain/ledger'
import { QUANTITY_SCALE } from '@/domain/decimal'
import { minor, money } from '@/domain/money'
import { getExpenseByCategory, getMonthSummary, getNetWorthHistory } from './service'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
  ])
})

describe('getMonthSummary', () => {
  it('sums income/expense/net in a single currency and excludes transfers', async () => {
    const bank = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const cash = await createAccount({ name: 'Efectivo', type: 'cash', currency: 'ARS', openingBalance: minor(0) })
    const foodCat = await createCategory({ name: 'Comida', kind: 'expense' })
    const salaryCat = await createCategory({ name: 'Sueldo', kind: 'income' })

    await saveTransaction(
      buildExpense({ date: '2026-08-05', description: 'Super', accountId: bank.id, categoryId: foodCat.id, amount: money(1000, 'ARS') }),
    )
    await saveTransaction(
      buildIncome({ date: '2026-08-01', description: 'Sueldo', accountId: bank.id, categoryId: salaryCat.id, amount: money(5000, 'ARS') }),
    )
    await saveTransaction(
      buildTransfer({ date: '2026-08-10', description: 'Ahorro', fromAccountId: bank.id, toAccountId: cash.id, amount: money(500, 'ARS') }),
    )

    const summary = await getMonthSummary('2026-08')
    expect(summary.income).toEqual(money(5000, 'ARS'))
    expect(summary.expense).toEqual(money(1000, 'ARS'))
    expect(summary.net).toEqual(money(4000, 'ARS'))
    expect(summary.missingRateCount).toBe(0)
  })

  it('converts cross-currency expenses to the base currency using the rate at the transaction date', async () => {
    const usdAccount = await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })
    const category = await createCategory({ name: 'Viajes', kind: 'expense' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 })

    await saveTransaction(
      buildExpense({ date: '2026-08-15', description: 'Hotel', accountId: usdAccount.id, categoryId: category.id, amount: money(100, 'USD') }),
    )

    const summary = await getMonthSummary('2026-08') // baseCurrency defaults to ARS
    expect(summary.expense).toEqual(money(100_000, 'ARS')) // 100 USD * 1000
    expect(summary.missingRateCount).toBe(0)
  })

  it("prefers settings.rateProfile's rate over an untagged one for the same pair/date", async () => {
    const usdAccount = await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })
    const category = await createCategory({ name: 'Viajes', kind: 'expense' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 }) // untagged
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1500, profile: 'blue' })
    await updateSettings({ rateProfile: 'blue' })

    await saveTransaction(
      buildExpense({ date: '2026-08-15', description: 'Hotel', accountId: usdAccount.id, categoryId: category.id, amount: money(100, 'USD') }),
    )

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(150_000, 'ARS')) // 100 USD * 1500 (blue), not * 1000
  })

  it('counts a missing rate instead of throwing, and does not let it affect other totals', async () => {
    const arsAccount = await createAccount({ name: 'Banco ARS', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const usdAccount = await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })
    const category = await createCategory({ name: 'Varios', kind: 'expense' })
    // no exchange rate loaded at all

    await saveTransaction(
      buildExpense({ date: '2026-08-05', description: 'Compra ARS', accountId: arsAccount.id, categoryId: category.id, amount: money(2000, 'ARS') }),
    )
    await saveTransaction(
      buildExpense({ date: '2026-08-06', description: 'Compra USD', accountId: usdAccount.id, categoryId: category.id, amount: money(50, 'USD') }),
    )

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(2000, 'ARS')) // only the ARS one counted
    expect(summary.missingRateCount).toBe(1)
  })

  it('excludes projected transactions, only counting confirmed ones', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const category = await createCategory({ name: 'Comida', kind: 'expense' })

    const projectedEntry = buildExpense({
      date: '2026-08-05',
      description: 'Cuota futura',
      accountId: account.id,
      categoryId: category.id,
      amount: money(9999, 'ARS'),
    })
    await saveTransaction({ ...projectedEntry, status: 'projected' })

    await saveTransaction(
      buildExpense({ date: '2026-08-06', description: 'Real', accountId: account.id, categoryId: category.id, amount: money(300, 'ARS') }),
    )

    const summary = await getMonthSummary('2026-08')
    expect(summary.expense).toEqual(money(300, 'ARS')) // the projected 9999 must not appear
  })
})

describe('getExpenseByCategory', () => {
  it('groups and sorts by total amount descending', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const food = await createCategory({ name: 'Comida', kind: 'expense' })
    const transport = await createCategory({ name: 'Transporte', kind: 'expense' })

    await saveTransaction(buildExpense({ date: '2026-08-01', description: 'a', accountId: account.id, categoryId: food.id, amount: money(1000, 'ARS') }))
    await saveTransaction(buildExpense({ date: '2026-08-02', description: 'b', accountId: account.id, categoryId: food.id, amount: money(500, 'ARS') }))
    await saveTransaction(buildExpense({ date: '2026-08-03', description: 'c', accountId: account.id, categoryId: transport.id, amount: money(200, 'ARS') }))

    const { items, missingRateCount } = await getExpenseByCategory('2026-08')
    expect(items).toEqual([
      { categoryId: food.id, categoryName: 'Comida', amount: money(1500, 'ARS') },
      { categoryId: transport.id, categoryName: 'Transporte', amount: money(200, 'ARS') },
    ])
    expect(missingRateCount).toBe(0)
  })

  it('counts a missing rate and falls back to a placeholder name for a deleted category', async () => {
    const usdAccount = await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })
    // No category record exists for this id — simulates a dangling
    // reference (categories today can only be archived, never hard-deleted,
    // but the fallback should still hold if that ever changes).
    await saveTransaction(
      buildExpense({ date: '2026-08-01', description: 'Sin tasa', accountId: usdAccount.id, categoryId: 'missing-category', amount: money(10, 'USD') }),
    )

    const { items, missingRateCount } = await getExpenseByCategory('2026-08')
    expect(missingRateCount).toBe(1)
    expect(items).toEqual([])

    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1000 })
    const afterRate = await getExpenseByCategory('2026-08')
    expect(afterRate.items).toEqual([
      { categoryId: 'missing-category', categoryName: 'Categoría eliminada', amount: money(10_000, 'ARS') },
    ])
  })

  it('skips a transaction with no category posting instead of crashing', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const now = new Date().toISOString()
    const txId = 'tx-no-category'
    await db.transactions.add({
      id: txId,
      date: '2026-08-01',
      kind: 'expense',
      description: 'Malformed',
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    })
    await db.postings.add({
      id: 'posting-no-category',
      transactionId: txId,
      target: 'account',
      accountId: account.id,
      amount: -500,
      currency: 'ARS',
      date: '2026-08-01',
    })

    const { items, missingRateCount } = await getExpenseByCategory('2026-08')
    expect(items).toEqual([])
    expect(missingRateCount).toBe(0)
  })
})

describe('getNetWorthHistory', () => {
  it('sums account balances converted to the base currency', async () => {
    await createAccount({ name: 'Banco ARS', type: 'bank', currency: 'ARS', openingBalance: minor(100_000) })
    await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(100) })
    await createExchangeRate({ date: '2026-01-01', from: 'USD', to: 'ARS', rate: 1000 })

    // monthsBack: 1 -> the single point is "today" (see getNetWorthHistory's
    // own i === 0 case), same as the now-removed getCurrentNetWorth.
    const { points, missingRateCount } = await getNetWorthHistory(1)
    expect(points[0]?.netWorth).toEqual(money(200_000, 'ARS')) // 100000 + 100*1000
    expect(missingRateCount).toBe(0)
  })

  it('counts an account it cannot convert instead of throwing', async () => {
    await createAccount({ name: 'Banco ARS', type: 'bank', currency: 'ARS', openingBalance: minor(100_000) })
    await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(100) })
    // no exchange rate loaded at all

    const { points, missingRateCount } = await getNetWorthHistory(2)
    expect(points.every((p) => p.netWorth.amount === 100_000)).toBe(true)
    expect(missingRateCount).toBe(2) // one USD account miss per point
  })

  it('uses the rate that was in effect at each historical point, not the latest one', async () => {
    // Fake only Date (not timers) — faking setTimeout/Promise scheduling
    // too makes Dexie's internal transaction machinery hang indefinitely.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    try {
      await updateSettings({ baseCurrency: 'ARS' })
      await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(100) })
      // A rate change mid-window: 500 until mid-July, 1000 from then on.
      await createExchangeRate({ date: '2026-01-01', from: 'USD', to: 'ARS', rate: 500 })
      await createExchangeRate({ date: '2026-07-15', from: 'USD', to: 'ARS', rate: 1000 })

      const { points, missingRateCount } = await getNetWorthHistory(3) // Jun, Jul, Aug(today)
      expect(missingRateCount).toBe(0)
      expect(points.map((p) => [p.month, p.netWorth.amount])).toEqual([
        ['2026-06', 50_000], // 100 USD * 500 (rate valid at 2026-06-30)
        ['2026-07', 100_000], // 100 USD * 1000 (rate changed 2026-07-15, valid at 2026-07-31)
        ['2026-08', 100_000], // 100 USD * 1000 (still valid as of "today" 2026-08-23)
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('includes a savings holding\'s current amount in every historical point', async () => {
    await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(100_000) })
    await createSavingsHolding({ name: 'Efectivo', currency: 'ARS', amount: 50_000 })

    // Savings has no history of its own — see docs/DECISIONS.md — so
    // "today's amount" is what every past point uses too.
    const { points, missingRateCount } = await getNetWorthHistory(3)
    expect(missingRateCount).toBe(0)
    expect(points.every((p) => p.netWorth.amount === 150_000)).toBe(true)
  })

  it('revalues an investment position at each month\'s own historical price, not the latest one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    try {
      await updateSettings({ baseCurrency: 'ARS' })
      const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'ARS', priceMode: 'manual' })
      await createInvestmentHolding({ assetId: asset.id, quantity: 2 * QUANTITY_SCALE })
      // Price changed mid-window: 1000 until mid-July, 1500 from then on —
      // same shape as the existing exchange-rate-history test above.
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
