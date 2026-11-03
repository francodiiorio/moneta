import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createCategory, setCategoryArchived } from '@/database/repositories/categories.repo'
import { listCategories, listTransactionsForMonth, saveExpense } from './service'
import type { ExpenseFormValues } from './schema'

afterEach(async () => {
  await Promise.all([db.categories.clear(), db.expenses.clear()])
})

describe('saveExpense', () => {
  it('rejects a zero or negative amount', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })

    const values: ExpenseFormValues = {
      date: '2026-08-23',
      description: 'x',
      categoryId: category.id,
      currency: 'ARS',
      amount: '0',
    }
    await expect(saveExpense(values)).rejects.toThrow(/mayor a cero/)
    expect(await db.expenses.count()).toBe(0)
  })

  it('persists a confirmed expense with the parsed amount', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })

    await saveExpense({
      date: '2026-08-23',
      description: 'Supermercado',
      categoryId: category.id,
      currency: 'ARS',
      amount: '1.200,50',
    })

    const [expense] = await db.expenses.toArray()
    expect(expense).toMatchObject({
      description: 'Supermercado',
      categoryId: category.id,
      amount: 120_050,
      currency: 'ARS',
      status: 'confirmed',
    })
  })

  it('editing overwrites the existing expense instead of creating a new one', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await saveExpense({
      date: '2026-08-23',
      description: 'Supermercado',
      categoryId: category.id,
      currency: 'ARS',
      amount: '500',
    })
    const [first] = await db.expenses.toArray()
    const id = first!.id

    await saveExpense(
      { date: '2026-08-24', description: 'Super (editado)', categoryId: category.id, currency: 'ARS', amount: '600' },
      id,
    )

    expect(await db.expenses.count()).toBe(1)
    const updated = await db.expenses.get(id)
    expect(updated).toMatchObject({ description: 'Super (editado)', amount: 60_000, date: '2026-08-24' })
  })
})

describe('listTransactionsForMonth', () => {
  it('excludes expenses outside the requested month', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await saveExpense({ date: '2026-08-23', description: 'Super', categoryId: category.id, currency: 'ARS', amount: '500' })

    expect(await listTransactionsForMonth('2026-07')).toHaveLength(0)
    expect(await listTransactionsForMonth('2026-08')).toHaveLength(1)
  })

  it('filters by categoryId', async () => {
    const a = await createCategory({ kind: 'expense', name: 'Comida' })
    const b = await createCategory({ kind: 'expense', name: 'Transporte' })
    await saveExpense({ date: '2026-08-23', description: 'Super', categoryId: a.id, currency: 'ARS', amount: '500' })
    await saveExpense({ date: '2026-08-24', description: 'Colectivo', categoryId: b.id, currency: 'ARS', amount: '100' })

    const filtered = await listTransactionsForMonth('2026-08', { categoryId: a.id })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.categoryId).toBe(a.id)
  })

  it('hides an archived category from the picker but keeps its name on past expenses', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await saveExpense({ date: '2026-08-23', description: 'Supermercado', categoryId: category.id, currency: 'ARS', amount: '500' })

    await setCategoryArchived(category.id, true)

    const pickerOptions = await listCategories('expense')
    expect(pickerOptions.find((c) => c.id === category.id)).toBeUndefined()

    const [item] = await listTransactionsForMonth('2026-08')
    expect(item?.categoryLabel).toBe('Comida')
  })

  it('carries a category\'s color/icon, omitting them when unset', async () => {
    const withIdentity = await createCategory({ kind: 'expense', name: 'Comida', color: '#ef4444', icon: 'utensils' })
    const withoutIdentity = await createCategory({ kind: 'expense', name: 'Otros' })

    await saveExpense({ date: '2026-08-01', description: 'Super', categoryId: withIdentity.id, currency: 'ARS', amount: '500' })
    await saveExpense({ date: '2026-08-02', description: 'Otro', categoryId: withoutIdentity.id, currency: 'ARS', amount: '300' })

    const items = await listTransactionsForMonth('2026-08')
    const withIdentityItem = items.find((i) => i.categoryLabel === 'Comida')
    const withoutIdentityItem = items.find((i) => i.categoryLabel === 'Otros')

    expect(withIdentityItem?.categoryColor).toBe('#ef4444')
    expect(withIdentityItem?.categoryIcon).toBe('utensils')
    expect(withoutIdentityItem?.categoryColor).toBeUndefined()
    expect(withoutIdentityItem?.categoryIcon).toBeUndefined()
  })
})

describe('ingresos en Movimientos (Etapa 10)', () => {
  afterEach(async () => {
    await db.incomes.clear()
  })

  it('saveMovement routes an ingreso to incomes — with no account — and lists it positive, next to gastos', async () => {
    const { saveMovement } = await import('./service')
    const incomeCategory = await createCategory({ kind: 'income', name: 'Sueldo' })
    const expenseCategory = await createCategory({ kind: 'expense', name: 'Comida' })

    await saveMovement({
      kind: 'income',
      date: '2026-08-05',
      description: 'Sueldo',
      categoryId: incomeCategory.id,
      currency: 'ARS',
      amount: '1000',
      cardId: '',
      statementPeriod: '',
    })
    await saveMovement({
      kind: 'expense',
      date: '2026-08-06',
      description: 'Super',
      categoryId: expenseCategory.id,
      currency: 'ARS',
      amount: '200',
      cardId: '',
      statementPeriod: '',
    })

    const items = await listTransactionsForMonth('2026-08')
    expect(items.map((i) => [i.kind, i.description, i.amount.amount, i.paymentLabel])).toEqual([
      ['expense', 'Super', -200_00, undefined],
      ['income', 'Sueldo', 1000_00, undefined],
    ])
    const [income] = await db.incomes.toArray()
    expect(income).not.toHaveProperty('accountId')
    const [expense] = await db.expenses.toArray()
    expect(expense).not.toHaveProperty('accountId')
  })

  it('removeTransaction deletes from the right table by kind', async () => {
    const { saveMovement, removeTransaction } = await import('./service')
    const incomeCategory = await createCategory({ kind: 'income', name: 'Sueldo' })
    await saveMovement({
      kind: 'income',
      date: '2026-08-05',
      description: 'Sueldo',
      categoryId: incomeCategory.id,
      currency: 'ARS',
      amount: '1000',
      cardId: '',
      statementPeriod: '',
    })
    const [item] = await listTransactionsForMonth('2026-08')
    await removeTransaction(item!.id, item!.kind)
    expect(await db.incomes.count()).toBe(0)
  })

  it('an ingreso saved before Etapa 10 with an account is still listed, as a plain ingreso', async () => {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const { saveIncome: saveIncomeRecord } = await import('@/database/repositories/incomes.repo')
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-08-01' })
    const category = await createCategory({ kind: 'income', name: 'Sueldo' })
    await saveIncomeRecord({ date: '2026-08-05', description: 'Sueldo', categoryId: category.id, accountId: account.id, amount: 1000_00, currency: 'ARS' })
    const [item] = await listTransactionsForMonth('2026-08')
    expect(item).toMatchObject({ kind: 'income', description: 'Sueldo', amount: { amount: 1000_00, currency: 'ARS' } })
    expect(item).not.toHaveProperty('accountId')
    await db.accounts.clear()
  })

  it('editing a gasto or ingreso from before Etapa 10 drops its account', async () => {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const { saveIncome: saveIncomeRecord } = await import('@/database/repositories/incomes.repo')
    const { saveExpense: saveExpenseRecord } = await import('@/database/repositories/expenses.repo')
    const { saveMovement } = await import('./service')
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-08-01' })
    const sueldo = await createCategory({ kind: 'income', name: 'Sueldo' })
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const incomeId = await saveIncomeRecord({ date: '2026-08-05', description: 'Sueldo', categoryId: sueldo.id, accountId: account.id, amount: 1000_00, currency: 'ARS' })
    const expenseId = await saveExpenseRecord({
      date: '2026-08-06',
      description: 'Coto',
      categoryId: comida.id,
      accountId: account.id,
      amount: 500_00,
      currency: 'ARS',
      status: 'confirmed',
    })
    const form = { date: '2026-08-06', currency: 'ARS', cardId: '', statementPeriod: '' }

    await saveMovement({ ...form, kind: 'income', description: 'Sueldo', categoryId: sueldo.id, amount: '1.000' }, incomeId)
    await saveMovement({ ...form, kind: 'expense', description: 'Coto', categoryId: comida.id, amount: '600' }, expenseId)

    expect(await db.incomes.get(incomeId)).not.toHaveProperty('accountId')
    expect(await db.expenses.get(expenseId)).toMatchObject({ amount: 600_00 })
    expect(await db.expenses.get(expenseId)).not.toHaveProperty('accountId')
    await db.accounts.clear()
  })
})

describe('Movimientos lista sólo gastos e ingresos', () => {
  afterEach(async () => {
    await Promise.all([
      db.accounts.clear(),
      db.accountAdjustments.clear(),
      db.transfers.clear(),
      db.incomes.clear(),
      db.creditCards.clear(),
      db.statementPayments.clear(),
      db.investmentAssets.clear(),
      db.investmentHoldings.clear(),
      db.investmentLots.clear(),
    ])
  })

  it('leaves out transfers, adjustments, investment purchases and card payments that are still in the db', async () => {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const { createAdjustment } = await import('@/database/repositories/accountAdjustments.repo')
    const { saveTransfer } = await import('@/database/repositories/transfers.repo')
    const { createInvestmentAsset } = await import('@/database/repositories/investments.repo')
    const { createInvestmentLot } = await import('@/database/repositories/investmentLots.repo')
    const { saveIncome: saveIncomeRecord } = await import('@/database/repositories/incomes.repo')
    const base = { type: 'bank' as const, openingBalance: 0, openingDate: '2026-08-01' }
    const ars = await createAccount({ ...base, name: 'Galicia', currency: 'ARS' })
    const ars2 = await createAccount({ ...base, name: 'Mercado Pago', currency: 'ARS' })
    await createAdjustment({ accountId: ars.id, date: '2026-08-10', amount: -150, currency: 'ARS' })
    await saveTransfer({
      date: '2026-08-10',
      description: 'Entre cuentas',
      fromAccountId: ars.id,
      toAccountId: ars2.id,
      fromAmount: 10_00,
      toAmount: 10_00,
      expectedFromCurrency: 'ARS',
      expectedToCurrency: 'ARS',
    })
    const asset = await createInvestmentAsset({ name: 'Apple', symbol: 'AAPL', type: 'cedear', currency: 'ARS', priceMode: 'manual' })
    await createInvestmentLot({
      assetId: asset.id,
      quantity: 1_000_000_000,
      currency: 'ARS',
      date: '2026-08-12',
      source: { accountId: ars.id, amount: 150_000_00, expectedCurrency: 'ARS' },
    })
    const { createCreditCard } = await import('@/database/repositories/creditCards.repo')
    const { payStatement } = await import('@/database/repositories/statementPayments.repo')
    const { saveExpense: saveExpenseRecord } = await import('@/database/repositories/expenses.repo')
    const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
    const food = await createCategory({ kind: 'expense', name: 'Comida' })
    const sueldo = await createCategory({ kind: 'income', name: 'Sueldo' })
    await saveExpenseRecord({ date: '2026-07-10', description: 'Netflix', categoryId: food.id, amount: 10_00, currency: 'USD', status: 'confirmed', cardId: card.id })
    await payStatement({ cardId: card.id, period: '2026-07', date: '2026-08-04', lines: [{ currency: 'USD', amount: 10_00 }] })
    await saveExpenseRecord({ date: '2026-08-14', description: 'Super', categoryId: food.id, amount: 20_00, currency: 'ARS', status: 'confirmed' })
    await saveIncomeRecord({ date: '2026-08-15', description: 'Sueldo', categoryId: sueldo.id, amount: 100_00, currency: 'ARS' })

    const items = await listTransactionsForMonth('2026-08')
    expect(items.map((i) => [i.kind, i.description])).toEqual([
      ['income', 'Sueldo'],
      ['expense', 'Super'],
    ])
    // A category filter keeps working on what is listed.
    expect((await listTransactionsForMonth('2026-08', { categoryId: food.id })).map((i) => i.description)).toEqual(['Super'])
  })
})

describe('gastos con tarjeta en Movimientos (Fase 4)', () => {
  afterEach(async () => {
    await Promise.all([db.creditCards.clear(), db.cardStatements.clear()])
  })

  it('saves card + statement ("" = automatic), labels the row, and flags pinned ones', async () => {
    const { saveMovement } = await import('./service')
    const { createCreditCard } = await import('@/database/repositories/creditCards.repo')
    const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
    const category = await createCategory({ kind: 'expense', name: 'Ropa' })
    const base = { kind: 'expense' as const, categoryId: category.id, currency: 'ARS', amount: '100', cardId: card.id }

    await saveMovement({ ...base, date: '2026-08-10', description: 'Auto', statementPeriod: '' })
    await saveMovement({ ...base, date: '2026-08-11', description: 'Fijado', statementPeriod: '2026-09' })

    const items = await listTransactionsForMonth('2026-08')
    const auto = items.find((i) => i.description === 'Auto')
    const pinned = items.find((i) => i.description === 'Fijado')
    expect(auto).toMatchObject({ cardId: card.id, statementPeriod: '2026-08', statementPinned: false })
    // August's statement, named by when it's due.
    expect(auto?.paymentLabel).toMatch(/^Visa · venc(e|ió) el 05\/09/)
    expect(pinned).toMatchObject({ statementPeriod: '2026-09', statementPinned: true })
  })
})

describe('listQuickPicks', () => {
  afterEach(async () => {
    await Promise.all([db.creditCards.clear(), db.incomes.clear()])
  })

  it('the merchants typed most in the last 90 days, each as it was loaded last time', async () => {
    const { listQuickPicks } = await import('./service')
    const { saveExpense: save } = await import('@/database/repositories/expenses.repo')
    const { createCreditCard, setCreditCardArchived } = await import('@/database/repositories/creditCards.repo')
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const transporte = await createCategory({ kind: 'expense', name: 'Transporte' })
    const visa = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })
    const old = await createCreditCard({ name: 'vieja', closingDay: 22, dueDay: 4 })
    const gasto = (date: string, description: string, categoryId: string, cardId?: string, extra = {}) =>
      save({ date, description, categoryId, amount: 1_000_00, currency: 'ARS', status: 'confirmed', ...(cardId && { cardId }), ...extra })

    await gasto('2026-10-01', 'Rappi', transporte.id)
    await gasto('2026-10-20', 'Rappi', comida.id, visa.id) // the latest wins
    await gasto('2026-10-21', 'rappi ', comida.id, visa.id) // same merchant
    await gasto('2026-10-25', 'Subte', transporte.id, old.id)
    await gasto('2026-06-01', 'Hace mucho', comida.id) // outside the window
    await gasto('2026-10-26', 'Mercado Libre (cuota 2/6)', comida.id, visa.id, { sourcePlanId: 'plan', occurrenceIndex: 1 })
    await setCreditCardArchived(old.id, true)

    const picks = await listQuickPicks('expense', '2026-11-01')
    expect(picks).toEqual([
      { description: 'rappi', categoryId: comida.id, currency: 'ARS', cardId: visa.id },
      // Its card was archived: no payment method to suggest.
      { description: 'Subte', categoryId: transporte.id, currency: 'ARS' },
    ])
  })
})
