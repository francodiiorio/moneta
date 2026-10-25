import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createCategory } from '@/database/repositories/categories.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import { createAccount } from '@/database/repositories/accounts.repo'
import { money } from '@/domain/money'
import {
  correctStatementDates,
  createCardFromForm,
  getOpenPeriod,
  getStatementDetail,
  listCardSummaries,
  payStatementFromForm,
  reconcileCurrencies,
  reconcileStatementFromForm,
  resetStatementDates,
  statementChoices,
  undoStatementPayment,
  updateCardFromForm,
} from './service'

afterEach(async () => {
  await Promise.all([
    db.creditCards.clear(),
    db.cardStatements.clear(),
    db.statementPayments.clear(),
    db.expenses.clear(),
    db.categories.clear(),
    db.accounts.clear(),
  ])
})

async function seed() {
  const card = await createCardFromForm({ name: 'Visa', closingDay: '25', dueDay: '5', closingDayToNext: false, openingClosedArs: '', openingClosedUsd: '', openingOpenArs: '', openingOpenUsd: '', notes: '' })
  const category = await createCategory({ kind: 'expense', name: 'Comida' })
  const base = { categoryId: category.id, status: 'confirmed' as const, cardId: card.id }
  // September statement (closed Sep 25): two currencies.
  await saveExpense({ ...base, date: '2026-09-10', description: 'Super', amount: 50_000_00, currency: 'ARS' })
  await saveExpense({ ...base, date: '2026-09-20', description: 'Netflix', amount: 10_00, currency: 'USD' })
  // October statement (open on Oct 23).
  await saveExpense({ ...base, date: '2026-10-02', description: 'Nafta', amount: 30_000_00, currency: 'ARS' })
  await saveExpense({
    ...base,
    date: '2026-10-20',
    description: 'Cuota 2/3',
    amount: 10_000_00,
    currency: 'ARS',
    status: 'projected',
    statementPeriod: '2026-10',
  })
  return card
}

describe('listCardSummaries', () => {
  it('shows the open statement (accumulating) and the previous one (to pay), with day counts', async () => {
    await seed()
    const [summary] = await listCardSummaries('2026-10-23')
    expect(summary?.current).toMatchObject({
      period: '2026-10',
      closeDate: '2026-10-25',
      dueDate: '2026-11-05',
      status: 'open',
      totals: [money(40_000_00, 'ARS')],
      projectedCount: 1,
    })
    expect(summary?.previous).toMatchObject({
      period: '2026-09',
      status: 'closed',
      dueDate: '2026-10-05',
      totals: [money(50_000_00, 'ARS'), money(10_00, 'USD')],
    })
    expect(summary?.daysToClose).toBe(2)
    expect(summary?.daysToDue).toBe(-18)
  })
})

describe('getStatementDetail', () => {
  it('lists the statement’s gastos, and reflects corrected dates', async () => {
    const card = await seed()
    await correctStatementDates(card.id, '2026-09', { closeDate: '2026-09-24', dueDate: '2026-10-06' })
    const detail = await getStatementDetail(card.id, '2026-09', '2026-10-23')
    expect(detail).toMatchObject({ closeDate: '2026-09-24', dueDate: '2026-10-06', isCorrected: true, status: 'closed' })
    expect(detail?.expenses.map((e) => e.description)).toEqual(['Netflix', 'Super'])
  })

  it('an upcoming statement is marked as such', async () => {
    const card = await seed()
    const detail = await getStatementDetail(card.id, '2026-11', '2026-10-23')
    expect(detail?.status).toBe('upcoming')
    expect(detail?.totals).toEqual([])
  })
})

describe('statementChoices / getOpenPeriod / form helpers', () => {
  it('offers the automatic statement and the next two', async () => {
    const card = await createCardFromForm({ name: 'Visa', closingDay: '25', dueDay: '5', closingDayToNext: false, openingClosedArs: '', openingClosedUsd: '', openingOpenArs: '', openingOpenUsd: '', notes: '' })
    expect((await statementChoices(card.id, '2026-10-26')).map((c) => c.period)).toEqual(['2026-11', '2026-12', '2027-01'])
  })

  it('getOpenPeriod is null for a card that does not exist', async () => {
    expect(await getOpenPeriod('ghost')).toBeNull()
  })

  it('editing clears notes when left empty, and corrected dates can be reset', async () => {
    const card = await createCardFromForm({ name: 'Visa', closingDay: '25', dueDay: '5', closingDayToNext: false, openingClosedArs: '', openingClosedUsd: '', openingOpenArs: '', openingOpenUsd: '', notes: 'vieja' })
    await updateCardFromForm(card.id, { name: 'Visa', closingDay: '25', dueDay: '5', closingDayToNext: false, openingClosedArs: '', openingClosedUsd: '', openingOpenArs: '', openingOpenUsd: '', notes: '' })
    expect((await db.creditCards.get(card.id))?.notes).toBeUndefined()

    await correctStatementDates(card.id, '2026-10', { closeDate: '2026-10-22', dueDate: '2026-11-03' })
    await resetStatementDates(card.id, '2026-10')
    expect(await db.cardStatements.count()).toBe(0)
  })
})

describe('paying a statement (Fase 5)', () => {
  async function seedWithAccounts() {
    const card = await seed()
    const base = { type: 'bank' as const, openingBalance: 0, openingDate: '2026-01-01' }
    const pesos = await createAccount({ ...base, name: 'Galicia', currency: 'ARS' })
    const dollars = await createAccount({ ...base, name: 'Caja USD', currency: 'USD' })
    // The totals the form showed — the service only needs the accounts'
    // currencies now (what was paid comes in each line).
    const shown = (_totals?: unknown) => ({
      accountCurrency: new Map([
        [pesos.id, 'ARS'],
        [dollars.id, 'USD'],
      ]),
    })
    return { card, pesos, dollars, shown }
  }

  it('an unpaid closed statement is pending until its due date, overdue after', async () => {
    const { card } = await seedWithAccounts()
    expect((await getStatementDetail(card.id, '2026-09', '2026-10-05'))?.due).toBe('pending')
    expect((await getStatementDetail(card.id, '2026-09', '2026-10-06'))?.due).toBe('overdue')
    expect((await getStatementDetail(card.id, '2026-12', '2026-10-23'))?.due).toBe('empty')
    // Two closes later it's history: no longer flagged as overdue.
    expect((await getStatementDetail(card.id, '2026-09', '2026-11-26'))?.due).toBe('unrecorded')
  })

  it('pays each currency — the dollars from the peso account at the real debit — and shows it as paid', async () => {
    const { card, pesos, shown } = await seedWithAccounts()
    const totals = [money(50_000_00, 'ARS'), money(10_00, 'USD')]
    await payStatementFromForm(
      card.id,
      '2026-09',
      {
        date: '2026-10-04',
        lines: [
          { currency: 'ARS', accountId: pesos.id, paidAmount: '50.000', debitedAmount: '' },
          { currency: 'USD', accountId: pesos.id, paidAmount: '10', debitedAmount: '12.500' },
        ],
      },
      shown(totals),
    )
    const detail = await getStatementDetail(card.id, '2026-09', '2026-10-23')
    expect(detail?.due).toBe('paid')
    expect(detail?.payments).toEqual([
      expect.objectContaining({ accountName: 'Galicia', amount: money(50_000_00, 'ARS'), debited: money(50_000_00, 'ARS') }),
      expect.objectContaining({ accountName: 'Galicia', amount: money(10_00, 'USD'), debited: money(12_500_00, 'ARS') }),
    ])
    const [summary] = await listCardSummaries('2026-10-23')
    expect(summary?.previous.due).toBe('paid')
  })

  it('a gasto billed into a paid statement leaves it "paid with a difference"; undoing makes it unpaid again', async () => {
    const { card, pesos, dollars, shown } = await seedWithAccounts()
    const totals = [money(50_000_00, 'ARS'), money(10_00, 'USD')]
    await payStatementFromForm(
      card.id,
      '2026-09',
      {
        date: '2026-10-04',
        lines: [
          { currency: 'ARS', accountId: pesos.id, paidAmount: '50.000', debitedAmount: '' },
          { currency: 'USD', accountId: dollars.id, paidAmount: '10', debitedAmount: '' },
        ],
      },
      shown(totals),
    )
    const category = await createCategory({ kind: 'expense', name: 'Tarde' })
    await saveExpense({
      date: '2026-09-15',
      description: 'Presentación tardía',
      categoryId: category.id,
      amount: 2_000_00,
      currency: 'ARS',
      status: 'confirmed',
      cardId: card.id,
    })
    const detail = await getStatementDetail(card.id, '2026-09', '2026-10-23')
    expect(detail?.due).toBe('mismatch')
    expect(detail?.payment.differences).toEqual([money(2_000_00, 'ARS')])

    await undoStatementPayment(card.id, '2026-09')
    expect((await getStatementDetail(card.id, '2026-09', '2026-10-23'))?.due).toBe('overdue')
  })

  it('across currencies the debited amount is required', async () => {
    const { card, pesos, shown } = await seedWithAccounts()
    await expect(
      payStatementFromForm(
        card.id,
        '2026-09',
        {
          date: '2026-10-04',
          lines: [
            { currency: 'ARS', accountId: pesos.id, paidAmount: '50.000', debitedAmount: '' },
            { currency: 'USD', accountId: pesos.id, paidAmount: '10', debitedAmount: '' },
          ],
        },
        shown([money(50_000_00, 'ARS'), money(10_00, 'USD')]),
      ),
    ).rejects.toThrow(/cuánto se debitó/)
  })
})

describe('reconciling a statement against the bank (Fase 6)', () => {
  it('registers what the bank billed above Moneta as a gasto of that statement, dated at its close', async () => {
    const card = await seed()
    const category = await createCategory({ kind: 'expense', name: 'Impuestos' })
    const shown = [money(50_000_00, 'ARS'), money(10_00, 'USD')]
    const created = await reconcileStatementFromForm(
      card.id,
      '2026-09',
      {
        lines: [
          { currency: 'ARS', bankTotal: '53.250' },
          { currency: 'USD', bankTotal: '10' },
        ],
        categoryId: category.id,
        description: '',
      },
      shown,
    )
    expect(created).toBe(1)
    const detail = await getStatementDetail(card.id, '2026-09', '2026-10-23')
    expect(detail?.totals).toEqual([money(53_250_00, 'ARS'), money(10_00, 'USD')])
    expect(detail?.expenses.find((e) => e.description.startsWith('Cargos del resumen'))).toMatchObject({
      date: '2026-09-25',
      amount: money(3_250_00, 'ARS'),
    })
  })

  it('nothing to register when the bank billed the same or less; rejects if the totals changed meanwhile', async () => {
    const card = await seed()
    const category = await createCategory({ kind: 'expense', name: 'Impuestos' })
    const values = { lines: [{ currency: 'ARS', bankTotal: '49.000' }], categoryId: category.id, description: '' }
    await expect(reconcileStatementFromForm(card.id, '2026-09', values, [money(50_000_00, 'ARS')])).rejects.toThrow(
      /No hay diferencias/,
    )
    const stale = { ...values, lines: [{ currency: 'ARS', bankTotal: '60.000' }] }
    await expect(reconcileStatementFromForm(card.id, '2026-09', stale, [money(40_000_00, 'ARS')])).rejects.toThrow(/cambió/)
  })

  it('asks for the statement’s currencies plus ARS and USD', () => {
    expect(reconcileCurrencies([money(1, 'EUR')])).toEqual(['EUR', 'ARS', 'USD'])
    expect(reconcileCurrencies([money(1, 'USD')])).toEqual(['USD', 'ARS'])
  })
})

describe('saldo inicial de la tarjeta (A)', () => {
  const base = { name: 'visa 2551', closingDay: '22', dueDay: '4', closingDayToNext: false, notes: '' }
  const blank = { openingClosedArs: '', openingClosedUsd: '', openingOpenArs: '', openingOpenUsd: '' }

  afterEach(async () => {
    await Promise.all([db.statementPayments.clear(), db.accounts.clear()])
  })

  it('a card added mid-cycle carries what was owed: the closed statement and the open one so far', async () => {
    const card = await createCardFromForm(
      { ...base, ...blank, openingClosedArs: '480.000', openingClosedUsd: '12', openingOpenArs: '35.000' },
      '2026-10-25',
    )
    expect(card.openingBalances).toEqual([
      { period: '2026-10', currency: 'ARS', amount: 480_000_00 },
      { period: '2026-10', currency: 'USD', amount: 12_00 },
      { period: '2026-11', currency: 'ARS', amount: 35_000_00 },
    ])
    const october = await getStatementDetail(card.id, '2026-10', '2026-10-25')
    expect(october?.totals).toEqual([money(480_000_00, 'ARS'), money(12_00, 'USD')])
    expect(october?.openingBalance).toEqual([money(480_000_00, 'ARS'), money(12_00, 'USD')])
    expect(october?.due).toBe('pending')
  })

  it('it is paid from an account like any statement, and never counts as a gasto', async () => {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const { getMonthSummary } = await import('@/features/reports/service')
    const card = await createCardFromForm({ ...base, ...blank, openingClosedArs: '480.000' }, '2026-10-25')
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 1_000_000_00, openingDate: '2026-10-01' })
    await payStatementFromForm(
      card.id,
      '2026-10',
      { date: '2026-11-04', lines: [{ currency: 'ARS', accountId: account.id, paidAmount: '480.000', debitedAmount: '' }] },
      { accountCurrency: new Map([[account.id, 'ARS']]) },
    )
    expect((await getStatementDetail(card.id, '2026-10', '2026-11-05'))?.due).toBe('paid')
    expect((await getMonthSummary('2026-10')).expense.amount).toBe(0)
  })

  it('editing keeps the statements it was entered for; it can’t change once that statement is paid', async () => {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const card = await createCardFromForm({ ...base, ...blank, openingClosedArs: '480.000' }, '2026-10-25')
    // A month later, the "closed" field still means October.
    await updateCardFromForm(card.id, { ...base, ...blank, openingClosedArs: '481.000' }, '2026-11-25')
    expect((await getStatementDetail(card.id, '2026-10', '2026-11-25'))?.openingBalance).toEqual([money(481_000_00, 'ARS')])

    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-10-01' })
    await payStatementFromForm(
      card.id,
      '2026-10',
      { date: '2026-11-04', lines: [{ currency: 'ARS', accountId: account.id, paidAmount: '481.000', debitedAmount: '' }] },
      { accountCurrency: new Map([[account.id, 'ARS']]) },
    )
    await expect(updateCardFromForm(card.id, { ...base, ...blank, openingClosedArs: '1' }, '2026-11-25')).rejects.toThrow(
      /pagado o conciliado/,
    )
  })

  it('editing months later keeps the statements it was entered for, even with only the open one', async () => {
    const card = await createCardFromForm({ ...base, ...blank, openingOpenArs: '35.000' }, '2026-10-25')
    expect(card.openingBase).toBe('2026-10')
    expect(card.openingBalances).toEqual([{ period: '2026-11', currency: 'ARS', amount: 35_000_00 }])
    const { openingFormValues } = await import('./service')
    const stored = await db.creditCards.get(card.id)
    // Still the "open" field, still November — not shifted a month.
    expect(openingFormValues(stored!)).toMatchObject({ openingClosedArs: '', openingOpenArs: '35.000,00' })
    await updateCardFromForm(card.id, { ...base, ...blank, openingClosedArs: '480.000', openingOpenArs: '35.000' }, '2027-01-10')
    expect((await db.creditCards.get(card.id))?.openingBalances).toEqual([
      { period: '2026-10', currency: 'ARS', amount: 480_000_00 },
      { period: '2026-11', currency: 'ARS', amount: 35_000_00 },
    ])
  })

  it('an entry the form can’t show (another currency) survives an edit', async () => {
    const card = await createCardFromForm({ ...base, ...blank, openingClosedArs: '100' }, '2026-10-25')
    await db.creditCards.update(card.id, {
      openingBalances: [...card.openingBalances!, { period: '2026-10', currency: 'EUR', amount: 5_00 }],
    })
    await updateCardFromForm(card.id, { ...base, ...blank, name: 'visa renombrada', openingClosedArs: '100' }, '2026-10-25')
    expect((await db.creditCards.get(card.id))?.openingBalances).toEqual(
      expect.arrayContaining([{ period: '2026-10', currency: 'EUR', amount: 5_00 }]),
    )
  })

  it('an unpaid opening balance stays overdue: it is owed, not "paid before Moneta"', async () => {
    const card = await createCardFromForm({ ...base, ...blank, openingClosedArs: '480.000' }, '2026-10-25')
    // Two closes later.
    expect((await getStatementDetail(card.id, '2026-10', '2026-12-25'))?.due).toBe('overdue')
  })
})


describe('pagar cada moneda por su lado (revisión de C)', () => {
  afterEach(async () => {
    await Promise.all([db.statementPayments.clear(), db.accounts.clear()])
  })

  it('pesos today, dollars later: until both are paid the statement stays owed, showing what’s left', async () => {
    const card = await seed()
    const base = { type: 'bank' as const, openingBalance: 0, openingDate: '2026-01-01' }
    const pesos = await createAccount({ ...base, name: 'Galicia', currency: 'ARS' })
    const dollars = await createAccount({ ...base, name: 'Caja USD', currency: 'USD' })
    const shown = { accountCurrency: new Map([[pesos.id, 'ARS'], [dollars.id, 'USD']]) }
    await payStatementFromForm(
      card.id,
      '2026-09',
      { date: '2026-10-03', lines: [{ currency: 'ARS', accountId: pesos.id, paidAmount: '50.000', debitedAmount: '' }] },
      shown,
    )
    const partly = await getStatementDetail(card.id, '2026-09', '2026-10-04')
    expect(partly?.due).toBe('pending')
    expect(partly?.unpaidCurrencies).toEqual(['USD'])
    expect(partly?.owed).toEqual([money(10_00, 'USD')])
    expect((await getStatementDetail(card.id, '2026-09', '2026-10-06'))?.due).toBe('overdue')

    // Paying pesos again is rejected; the dollars go through.
    await expect(
      payStatementFromForm(
        card.id,
        '2026-09',
        { date: '2026-10-04', lines: [{ currency: 'ARS', accountId: pesos.id, paidAmount: '1', debitedAmount: '' }] },
        shown,
      ),
    ).rejects.toThrow(/ya tiene un pago en ARS/)
    await payStatementFromForm(
      card.id,
      '2026-09',
      { date: '2026-10-04', lines: [{ currency: 'USD', accountId: dollars.id, paidAmount: '10', debitedAmount: '' }] },
      shown,
    )
    expect((await getStatementDetail(card.id, '2026-09', '2026-10-06'))?.due).toBe('paid')
  })

  it('paying less than Moneta has, in every currency, is "pagado con diferencia" — not owed', async () => {
    const card = await seed()
    const pesos = await createAccount({ type: 'bank', openingBalance: 0, openingDate: '2026-01-01', name: 'Galicia', currency: 'ARS' })
    await payStatementFromForm(
      card.id,
      '2026-09',
      {
        date: '2026-10-03',
        lines: [
          { currency: 'ARS', accountId: pesos.id, paidAmount: '40.000', debitedAmount: '' },
          { currency: 'USD', accountId: pesos.id, paidAmount: '10', debitedAmount: '12.000' },
        ],
      },
      { accountCurrency: new Map([[pesos.id, 'ARS']]) },
    )
    const detail = await getStatementDetail(card.id, '2026-09', '2026-10-06')
    expect(detail?.due).toBe('mismatch')
    expect(detail?.payment.differences).toEqual([money(10_000_00, 'ARS')])
  })
})
