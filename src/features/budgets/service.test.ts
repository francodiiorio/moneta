import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createAccount } from '@/database/repositories/accounts.repo'
import { createBudget, deleteBudget } from '@/database/repositories/budgets.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { createExchangeRate } from '@/database/repositories/exchangeRates.repo'
import { saveTransaction } from '@/database/repositories/transactions.repo'
import { buildExpense, buildInvestmentPurchase } from '@/domain/ledger'
import { minor, money } from '@/domain/money'
import { getBudgetsWithProgress } from './service'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.budgets.clear(),
  ])
})

describe('getBudgetsWithProgress', () => {
  it('compares a monthly budget against the selected month\'s spend', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const food = await createCategory({ name: 'Comida', kind: 'expense' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveTransaction(
      buildExpense({ date: '2026-08-05', description: 'Super', accountId: account.id, categoryId: food.id, amount: money(4_000, 'ARS') }),
    )

    const { items, missingRateCount } = await getBudgetsWithProgress('2026-08')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ categoryId: food.id, categoryName: 'Comida', period: 'monthly' })
    expect(items[0]!.progress.budget).toEqual(money(10_000, 'ARS'))
    expect(items[0]!.progress.actual).toEqual(money(4_000, 'ARS'))
    expect(items[0]!.progress.percentUsed).toBe(40)
    expect(missingRateCount).toBe(0)
  })

  // Regression: getBudgetsWithProgress reuses getExpenseByCategoryInRange
  // for its "spent so far" number, which filters strictly on
  // transaction.kind === 'expense' — a kind: 'investment' transaction
  // posting against the SAME category never counts against a budget on
  // it, no matter how the money's categorized. See ADR "Una compra de
  // inversión no es un gasto".
  it('does not count an investment purchase against a budget on the same category', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const investmentCat = await createCategory({ name: 'Compra de inversiones', kind: 'expense' })
    await createBudget({ categoryId: investmentCat.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveTransaction(
      buildInvestmentPurchase({
        date: '2026-08-05',
        description: 'Compra SPY',
        accountId: account.id,
        categoryId: investmentCat.id,
        amount: money(50_000, 'ARS'),
      }),
    )

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]!.progress.actual).toEqual(money(0, 'ARS'))
  })

  it('carries the category\'s color/icon, omitting them when unset', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const food = await createCategory({ name: 'Comida', kind: 'expense', color: '#ef4444', icon: 'utensils' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveTransaction(
      buildExpense({ date: '2026-08-05', description: 'Super', accountId: account.id, categoryId: food.id, amount: money(4_000, 'ARS') }),
    )

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]?.categoryColor).toBe('#ef4444')
    expect(items[0]?.categoryIcon).toBe('utensils')
  })

  it('omits categoryColor/categoryIcon for a category with neither set', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const food = await createCategory({ name: 'Comida', kind: 'expense' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await saveTransaction(
      buildExpense({ date: '2026-08-05', description: 'Super', accountId: account.id, categoryId: food.id, amount: money(4_000, 'ARS') }),
    )

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]?.categoryColor).toBeUndefined()
    expect(items[0]?.categoryIcon).toBeUndefined()
  })

  it('accumulates spend across the whole year for a yearly budget', async () => {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const travel = await createCategory({ name: 'Viajes', kind: 'expense' })
    await createBudget({ categoryId: travel.id, currency: 'ARS', period: 'yearly', amount: 100_000, startsOn: '2026-01' })
    await saveTransaction(
      buildExpense({ date: '2026-02-01', description: 'Vuelo', accountId: account.id, categoryId: travel.id, amount: money(30_000, 'ARS') }),
    )
    await saveTransaction(
      buildExpense({ date: '2026-07-01', description: 'Hotel', accountId: account.id, categoryId: travel.id, amount: money(20_000, 'ARS') }),
    )

    const { items } = await getBudgetsWithProgress('2026-08') // browsed month shouldn't matter for yearly
    expect(items).toHaveLength(1)
    expect(items[0]!.progress.actual).toEqual(money(50_000, 'ARS')) // 30000 + 20000
    expect(items[0]!.progress.percentUsed).toBe(50)
  })

  it('shows a budgeted category with zero actual spend as 0% used', async () => {
    const food = await createCategory({ name: 'Comida', kind: 'expense' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })

    const { items } = await getBudgetsWithProgress('2026-08')
    expect(items[0]!.progress.actual).toEqual(money(0, 'ARS'))
    expect(items[0]!.progress.percentUsed).toBe(0)
  })

  it('uses the budget version in effect for the evaluated month, not always the latest', async () => {
    const food = await createCategory({ name: 'Comida', kind: 'expense' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 20_000, startsOn: '2026-08' })

    const july = await getBudgetsWithProgress('2026-07')
    expect(july.items[0]!.progress.budget).toEqual(money(10_000, 'ARS'))

    const august = await getBudgetsWithProgress('2026-08')
    expect(august.items[0]!.progress.budget).toEqual(money(20_000, 'ARS'))
  })

  it('keeps resolving correctly after deleting the middle version of three', async () => {
    const food = await createCategory({ name: 'Comida', kind: 'expense' })
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
    const food = await createCategory({ name: 'Comida', kind: 'expense' })
    await createBudget({ categoryId: food.id, currency: 'USD', period: 'monthly', amount: 100, startsOn: '2026-01' })
    await createExchangeRate({ date: '2026-01-01', from: 'USD', to: 'ARS', rate: 1000 })

    const { items, missingRateCount } = await getBudgetsWithProgress('2026-08') // baseCurrency defaults to ARS
    expect(items[0]!.progress.budget).toEqual(money(100_000, 'ARS')) // 100 USD * 1000
    expect(missingRateCount).toBe(0)
  })

  it('passes through missingRateCount when actual spend cannot be converted', async () => {
    const usdAccount = await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })
    const food = await createCategory({ name: 'Comida', kind: 'expense' })
    await createBudget({ categoryId: food.id, currency: 'ARS', period: 'monthly', amount: 10_000, startsOn: '2026-01' })
    // no exchange rate loaded — this expense can't be converted to ARS
    await saveTransaction(
      buildExpense({ date: '2026-08-05', description: 'Compra', accountId: usdAccount.id, categoryId: food.id, amount: money(10, 'USD') }),
    )

    const { missingRateCount } = await getBudgetsWithProgress('2026-08')
    expect(missingRateCount).toBe(1)
  })
})
