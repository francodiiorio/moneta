import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { createCategory } from './categories.repo'
import { createCreditCard, deleteCreditCard, listCreditCards, updateCreditCard } from './creditCards.repo'
import { listCardExpenses, removeStatementOverride, setStatementOverride } from './cardStatements.repo'
import { saveExpense, type ExpenseInput } from './expenses.repo'

afterEach(async () => {
  await Promise.all([db.creditCards.clear(), db.cardStatements.clear(), db.expenses.clear(), db.categories.clear(), db.accounts.clear()])
})

async function setup() {
  const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
  const category = await createCategory({ kind: 'expense', name: 'Comida' })
  return { card, category }
}

function purchase(categoryId: string, cardId: string, overrides: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    date: '2026-10-24',
    description: 'Super',
    categoryId,
    amount: 1_000_00,
    currency: 'ARS',
    status: 'confirmed',
    cardId,
    ...overrides,
  }
}

describe('saveExpense with a card', () => {
  it('places it automatically in its statement by the card calendar', async () => {
    const { card, category } = await setup()
    const id = await saveExpense(purchase(category.id, card.id))
    expect(await db.expenses.get(id)).toMatchObject({ cardId: card.id, statementPeriod: '2026-10' })
    const late = await saveExpense(purchase(category.id, card.id, { date: '2026-10-26' }))
    expect((await db.expenses.get(late))?.statementPeriod).toBe('2026-11')
  })

  it('keeps a statement given explicitly (pinned)', async () => {
    const { card, category } = await setup()
    const id = await saveExpense(purchase(category.id, card.id, { statementPeriod: '2026-11' }))
    expect((await db.expenses.get(id))?.statementPeriod).toBe('2026-11')
  })

  it('rejects a card together with a debit account, and a statement without a card', async () => {
    const { card, category } = await setup()
    await expect(saveExpense(purchase(category.id, card.id, { accountId: 'a1' }))).rejects.toThrow(/débito o con tarjeta/)
    const noCard = purchase(category.id, card.id, { statementPeriod: '2026-10' })
    delete noCard.cardId
    await expect(saveExpense(noCard)).rejects.toThrow(/necesita una tarjeta/)
  })

  it('rejects a card that does not exist', async () => {
    const { category } = await setup()
    await expect(saveExpense(purchase(category.id, 'nope'))).rejects.toThrow(/Tarjeta no encontrada/)
  })
})

describe('statement overrides', () => {
  it('moving a close re-places automatic expenses but not pinned ones', async () => {
    const { card, category } = await setup()
    const auto = await saveExpense(purchase(category.id, card.id, { date: '2026-10-24' }))
    const pinned = await saveExpense(purchase(category.id, card.id, { date: '2026-10-10', statementPeriod: '2026-11' }))

    const moved = await setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-10-22', dueDate: '2026-11-03' })
    expect(moved).toBe(1)
    expect((await db.expenses.get(auto))?.statementPeriod).toBe('2026-11')
    expect((await db.expenses.get(pinned))?.statementPeriod).toBe('2026-11')

    // Back to the default days: the automatic one returns, the pinned stays.
    await removeStatementOverride(card.id, '2026-10')
    expect((await db.expenses.get(auto))?.statementPeriod).toBe('2026-10')
    expect((await db.expenses.get(pinned))?.statementPeriod).toBe('2026-11')
  })

  it('one override per period: setting it again updates the same row', async () => {
    const { card } = await setup()
    await setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-10-22', dueDate: '2026-11-03' })
    await setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-10-23', dueDate: '2026-11-04' })
    expect(await db.cardStatements.toArray()).toEqual([expect.objectContaining({ closeDate: '2026-10-23' })])
  })

  it('rejects a due date before the close', async () => {
    const { card } = await setup()
    await expect(
      setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-10-22', dueDate: '2026-10-21' }),
    ).rejects.toThrow(/vencimiento/)
  })

  it('changing the default closing day re-places automatic expenses too', async () => {
    // While October's statement is still open — a closed one is frozen.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T12:00:00'))
    try {
      const { card, category } = await setup()
      const id = await saveExpense(purchase(category.id, card.id, { date: '2026-10-24' }))
      await updateCreditCard(card.id, { name: 'Visa', closingDay: 20, dueDay: 5, notes: undefined })
      expect((await db.expenses.get(id))?.statementPeriod).toBe('2026-11')
      expect(await listCardExpenses(card.id, '2026-11')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('deleteCreditCard', () => {
  it('only a card without gastos; one with history gets archived instead', async () => {
    const { card, category } = await setup()
    await saveExpense(purchase(category.id, card.id))
    await expect(deleteCreditCard(card.id)).rejects.toThrow(/archivala/)

    const empty = await createCreditCard({ name: 'Master', closingDay: 1, dueDay: 10 })
    await setStatementOverride({ cardId: empty.id, period: '2026-10', closeDate: '2026-10-02', dueDate: '2026-10-12' })
    await deleteCreditCard(empty.id)
    expect((await listCreditCards()).map((c) => c.name)).toEqual(['Visa'])
    expect(await db.cardStatements.count()).toBe(0)
  })
})

async function withToday<T>(iso: string, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
  try {
    return await run()
  } finally {
    vi.useRealTimers()
  }
}

describe('revisión de la Fase 4a', () => {
  it('changing the card days never moves a gasto out of a statement that already closed', async () => {
    await withToday('2026-10-23T12:00:00Z', async () => {
      const { card, category } = await setup()
      const march = await saveExpense(purchase(category.id, card.id, { date: '2026-03-10' }))
      const current = await saveExpense(purchase(category.id, card.id, { date: '2026-10-10' }))

      // The bank moves the close to the 5th from now on.
      const moved = await updateCreditCard(card.id, { name: 'Visa', closingDay: 5, dueDay: 15, notes: undefined })

      expect((await db.expenses.get(march))?.statementPeriod).toBe('2026-03')
      // March's statement keeps the dates it was billed with.
      expect(await db.cardStatements.where('[cardId+period]').equals([card.id, '2026-03']).first()).toMatchObject({
        closeDate: '2026-03-25',
        dueDate: '2026-04-05',
      })
      // The open one follows the new days: Oct 10 is after a 5th close.
      expect((await db.expenses.get(current))?.statementPeriod).toBe('2026-11')
      expect(moved).toBe(1)
    })
  })

  it('editing the date of a gasto in an open statement re-places it (the form echoes the period back)', async () => {
    await withToday('2026-10-23T12:00:00Z', async () => {
      const { card, category } = await setup()
      const id = await saveExpense(purchase(category.id, card.id, { date: '2026-10-20' }))
      await saveExpense(purchase(category.id, card.id, { date: '2026-10-28', statementPeriod: '2026-10' }), id)
      expect((await db.expenses.get(id))?.statementPeriod).toBe('2026-11')
    })
  })

  it('an edit that keeps a pinned (non-automatic) statement keeps it', async () => {
    await withToday('2026-10-23T12:00:00Z', async () => {
      const { card, category } = await setup()
      const id = await saveExpense(purchase(category.id, card.id, { date: '2026-10-20', statementPeriod: '2026-11' }))
      await saveExpense(purchase(category.id, card.id, { date: '2026-10-21', statementPeriod: '2026-11' }), id)
      expect((await db.expenses.get(id))?.statementPeriod).toBe('2026-11')
    })
  })

  it('rejects a statement that closed before the gasto', async () => {
    const { card, category } = await setup()
    await expect(saveExpense(purchase(category.id, card.id, { date: '2026-10-26', statementPeriod: '2026-10' }))).rejects.toThrow(
      /cerró antes/,
    )
  })

  it('a pinned statement still checks the card exists', async () => {
    const { category } = await setup()
    await expect(saveExpense(purchase(category.id, 'gone', { statementPeriod: '2026-11' }))).rejects.toThrow(/Tarjeta no encontrada/)
  })

  it('rejects corrected dates that would break the order of closes', async () => {
    const { card } = await setup()
    await expect(
      setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2025-10-25', dueDate: '2025-11-05' }),
    ).rejects.toThrow(/ese mes o en el siguiente/)
    await expect(
      setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-11-26', dueDate: '2026-12-05' }),
    ).rejects.toThrow(/antes del siguiente/)
    expect(await db.cardStatements.count()).toBe(0)
  })
})

describe('cuotas y recurrentes con tarjeta (Fase 4b)', () => {
  afterEach(async () => {
    await Promise.all([db.installmentPlans.clear(), db.recurringPlans.clear()])
  })

  it('each cuota of a card purchase goes into the purchase’s statement + i', async () => {
    const { createInstallmentPlan } = await import('./installmentPlans.repo')
    const { card, category } = await setup()
    // Bought Oct 26 — after the 25th close — so it starts on November's.
    await createInstallmentPlan(
      {
        description: 'Heladera',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 300_000_00,
        count: 3,
        firstDueDate: '2026-10-26',
        purchaseDate: '2026-10-26',
        cardId: card.id,
      },
      '2026-10-26',
    )
    const cuotas = (await db.expenses.toArray()).sort((a, b) => (a.occurrenceIndex ?? 0) - (b.occurrenceIndex ?? 0))
    expect(cuotas.map((c) => [c.date, c.statementPeriod, c.cardId])).toEqual([
      ['2026-10-26', '2026-11', card.id],
      ['2026-11-26', '2026-12', card.id],
      ['2026-12-26', '2027-01', card.id],
    ])
    expect(cuotas.map((c) => c.status)).toEqual(['confirmed', 'projected', 'projected'])
  })

  it('editing a card installment plan keeps each projected cuota in its statement', async () => {
    const { createInstallmentPlan, updateInstallmentPlan } = await import('./installmentPlans.repo')
    const { card, category } = await setup()
    const plan = await createInstallmentPlan(
      {
        description: 'Tele',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 200_000_00,
        count: 2,
        firstDueDate: '2026-10-10',
        purchaseDate: '2026-10-10',
        cardId: card.id,
      },
      '2026-10-10',
    )
    await updateInstallmentPlan(plan.id, { description: 'Televisor', categoryId: category.id })
    const projected = (await db.expenses.toArray()).find((e) => e.status === 'projected')
    expect(projected).toMatchObject({ description: 'Televisor (cuota 2/2)', cardId: card.id, statementPeriod: '2026-11' })
  })

  it('a recurring plan with a card materializes gastos in their statements by date', async () => {
    const { createRecurringPlan, materializePlan } = await import('./recurringPlans.repo')
    const { card, category } = await setup()
    const plan = await createRecurringPlan({
      template: { description: 'Netflix', categoryId: category.id, amount: 10_00, currency: 'USD', cardId: card.id },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-10-28' },
    })
    await materializePlan(
      plan.id,
      [{ date: '2026-10-28', description: 'Netflix', categoryId: category.id, amount: 10_00, currency: 'USD', status: 'confirmed', sourcePlanId: plan.id, occurrenceIndex: 0, cardId: card.id }],
      '2026-10-28',
    )
    expect(await db.expenses.toArray()).toEqual([expect.objectContaining({ cardId: card.id, statementPeriod: '2026-11' })])
  })
})

describe('revisión de la Fase 4b', () => {
  afterEach(async () => {
    await Promise.all([db.installmentPlans.clear(), db.recurringPlans.clear()])
  })

  it('correcting a close after creating the cuotas lands them where creating them afterwards would', async () => {
    await withToday('2026-10-20T12:00:00Z', async () => {
      const { createInstallmentPlan } = await import('./installmentPlans.repo')
      const { card, category } = await setup()
      const base = { categoryId: category.id, currency: 'ARS', totalAmount: 300_00, count: 3, firstDueDate: '2026-10-24', purchaseDate: '2026-10-24', cardId: card.id }
      await createInstallmentPlan({ ...base, description: 'Antes' }, '2026-10-20')

      await setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-10-23', dueDate: '2026-11-03' })
      await createInstallmentPlan({ ...base, description: 'Después' }, '2026-10-20')

      const periodsOf = async (prefix: string) =>
        (await db.expenses.toArray())
          .filter((e) => e.description.startsWith(prefix))
          .sort((a, b) => (a.occurrenceIndex ?? 0) - (b.occurrenceIndex ?? 0))
          .map((e) => e.statementPeriod)
      expect(await periodsOf('Antes')).toEqual(['2026-11', '2026-12', '2027-01'])
      expect(await periodsOf('Después')).toEqual(['2026-11', '2026-12', '2027-01'])
    })
  })

  it('a card used by a plan can’t be deleted', async () => {
    const { createRecurringPlan } = await import('./recurringPlans.repo')
    const { card, category } = await setup()
    await createRecurringPlan({
      template: { description: 'Netflix', categoryId: category.id, amount: 10_00, currency: 'USD', cardId: card.id },
      rule: { freq: 'monthly', interval: 1, startDate: '2027-01-01' },
    })
    await expect(deleteCreditCard(card.id)).rejects.toThrow(/planes que usan esta tarjeta/)
  })

  it('an account debited by a plan can’t be deleted nor change currency', async () => {
    const { createRecurringPlan } = await import('./recurringPlans.repo')
    const { createAccount, deleteAccount, updateAccount } = await import('./accounts.repo')
    const { category } = await setup()
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
    await createRecurringPlan({
      template: { description: 'Alquiler', categoryId: category.id, amount: 100, currency: 'ARS', accountId: account.id },
      rule: { freq: 'monthly', interval: 1, startDate: '2027-01-01' },
    })
    await expect(deleteAccount(account.id)).rejects.toThrow(/recurrentes que debitan/)
    const edit = { name: 'Galicia', type: 'bank' as const, openingBalance: 0, notes: undefined }
    await expect(updateAccount(account.id, { ...edit, currency: 'USD', openingDate: '2026-01-01' })).rejects.toThrow(/moneda/)
    await expect(updateAccount(account.id, { ...edit, currency: 'ARS', openingDate: '2027-02-01' })).rejects.toThrow(/saldo inicial/)
  })

  it('adding a debit to a plan that already generated history only needs the account open from now on', async () => {
    const { createRecurringPlan, updateRecurringPlan } = await import('./recurringPlans.repo')
    const { createAccount } = await import('./accounts.repo')
    const { category } = await setup()
    const rule = { freq: 'monthly' as const, interval: 1, dayOfMonth: 5, startDate: '2025-01-05' }
    const template = { description: 'Alquiler', categoryId: category.id, amount: 100, currency: 'ARS' }
    const plan = await createRecurringPlan({ template, rule })
    await db.recurringPlans.update(plan.id, { lastMaterializedDate: '2026-06-05' })
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-06-10' })

    const updated = await updateRecurringPlan(plan.id, { template: { ...template, accountId: account.id }, rule })
    expect(updated.template.accountId).toBe(account.id)
  })
})

describe('compras del día de cierre al resumen siguiente', () => {
  afterEach(async () => {
    await db.statementPayments.clear()
  })

  it('turning it on moves a closing-day purchase from the just-closed statement to the open one', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    const card = await createCreditCard({ name: 'visa 2551', closingDay: 22, dueDay: 4 })
    await withToday('2026-10-25T12:00:00', async () => {
      const almuerzo = await saveExpense(purchase(category.id, card.id, { date: '2026-10-22', description: 'almuerzo' }))
      const dayBefore = await saveExpense(purchase(category.id, card.id, { date: '2026-10-21', description: 'antes' }))
      expect((await db.expenses.get(almuerzo))?.statementPeriod).toBe('2026-10')

      const moved = await updateCreditCard(card.id, { name: 'visa 2551', closingDay: 22, dueDay: 4, closingDayToNext: true, notes: undefined })
      expect(moved).toBe(1)
      expect((await db.expenses.get(almuerzo))?.statementPeriod).toBe('2026-11')
      expect((await db.expenses.get(dayBefore))?.statementPeriod).toBe('2026-10')
      expect((await db.creditCards.get(card.id))?.closingDayToNext).toBe(true)

      // And off again: back to the statement that closes that day.
      await updateCreditCard(card.id, { name: 'visa 2551', closingDay: 22, dueDay: 4, notes: undefined })
      expect((await db.expenses.get(almuerzo))?.statementPeriod).toBe('2026-10')
      expect((await db.creditCards.get(card.id))?.closingDayToNext).toBeUndefined()
    })
  })

  it('never moves a gasto out of a paid statement — rolls the whole edit back', async () => {
    const { payStatement } = await import('./statementPayments.repo')
    const { createAccount } = await import('./accounts.repo')
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    const card = await createCreditCard({ name: 'visa 2551', closingDay: 22, dueDay: 4 })
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
    await withToday('2026-10-25T12:00:00', async () => {
      await saveExpense(purchase(category.id, card.id, { date: '2026-10-22', description: 'almuerzo' }))
      await payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-10-24',
        lines: [{ currency: 'ARS', amount: 1_000_00, accountId: account.id, expectedAccountCurrency: 'ARS' }],
      })
      await expect(
        updateCreditCard(card.id, { name: 'visa 2551', closingDay: 22, dueDay: 4, closingDayToNext: true, notes: undefined }),
      ).rejects.toThrow(/resumen pagado o conciliado/)
      expect((await db.creditCards.get(card.id))?.closingDayToNext).toBeUndefined()
    })
  })
})

describe('revisión: la opción del día de cierre con cuotas y resúmenes conciliados', () => {
  afterEach(async () => {
    await Promise.all([db.installmentPlans.clear(), db.statementPayments.clear()])
  })

  async function cuotasOf(planId: string) {
    const rows = await db.expenses.filter((e) => e.sourcePlanId === planId).toArray()
    return rows.sort((a, b) => (a.occurrenceIndex ?? 0) - (b.occurrenceIndex ?? 0))
  }

  /** One cuota per statement, consecutive, each where its date allows. */
  async function expectConsistent(planId: string, cardId: string) {
    const { getCardCalendar } = await import('./creditCards.repo')
    const { statementPeriodFor } = await import('@/domain/cards')
    const calendar = await getCardCalendar(cardId)
    const cuotas = await cuotasOf(planId)
    const periods = cuotas.map((c) => c.statementPeriod!)
    expect(new Set(periods).size).toBe(periods.length)
    for (const c of cuotas) expect(c.statementPeriod! >= statementPeriodFor(calendar, c.date)).toBe(true)
    return periods
  }

  it('a purchase in cuotas on the closing day keeps one cuota per statement, toggling either way', async () => {
    const { createInstallmentPlan } = await import('./installmentPlans.repo')
    const category = await createCategory({ kind: 'expense', name: 'Hogar' })
    const card = await createCreditCard({ name: 'visa 2551', closingDay: 22, dueDay: 4 })
    await withToday('2026-10-25T12:00:00', async () => {
      const plan = await createInstallmentPlan(
        { description: 'Silla', categoryId: category.id, currency: 'ARS', totalAmount: 300, count: 3, firstDueDate: '2026-10-22', purchaseDate: '2026-10-22', cardId: card.id },
        '2026-10-25',
      )
      expect(await expectConsistent(plan.id, card.id)).toEqual(['2026-10', '2026-11', '2026-12'])

      await updateCreditCard(card.id, { name: 'visa 2551', closingDay: 22, dueDay: 4, closingDayToNext: true, notes: undefined })
      expect(await expectConsistent(plan.id, card.id)).toEqual(['2026-11', '2026-12', '2027-01'])
      // Cuota 1 keeps the purchase date — never a day before it.
      expect((await cuotasOf(plan.id))[0]?.date).toBe('2026-10-22')

      await updateCreditCard(card.id, { name: 'visa 2551', closingDay: 22, dueDay: 4, notes: undefined })
      expect(await expectConsistent(plan.id, card.id)).toEqual(['2026-10', '2026-11', '2026-12'])
    })
  })

  it('a purchase from an earlier closing day, toggled off, re-places its cuotas without doubling one up', async () => {
    const { createInstallmentPlan } = await import('./installmentPlans.repo')
    const category = await createCategory({ kind: 'expense', name: 'Hogar' })
    const card = await createCreditCard({ name: 'visa 2551', closingDay: 22, dueDay: 4, closingDayToNext: true })
    await withToday('2026-10-25T12:00:00', async () => {
      const plan = await createInstallmentPlan(
        { description: 'Mesa', categoryId: category.id, currency: 'ARS', totalAmount: 300, count: 3, firstDueDate: '2026-09-22', purchaseDate: '2026-09-22', cardId: card.id },
        '2026-10-25',
      )
      expect(await expectConsistent(plan.id, card.id)).toEqual(['2026-10', '2026-11', '2026-12'])
      await updateCreditCard(card.id, { name: 'visa 2551', closingDay: 22, dueDay: 4, notes: undefined })
      expect(await expectConsistent(plan.id, card.id)).toEqual(['2026-09', '2026-10', '2026-11'])
    })
  })

  it('never moves a gasto out of a reconciled statement either', async () => {
    const { addStatementDifferences } = await import('./cardStatements.repo')
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    const card = await createCreditCard({ name: 'visa 2551', closingDay: 22, dueDay: 4 })
    await withToday('2026-10-25T12:00:00', async () => {
      await saveExpense(purchase(category.id, card.id, { date: '2026-10-22', description: 'almuerzo' }))
      await addStatementDifferences({
        cardId: card.id,
        period: '2026-10',
        categoryId: category.id,
        description: 'Cargos',
        lines: [{ currency: 'ARS', expectedTotal: 1_000_00, bankTotal: 1_200_00 }],
      })
      await expect(
        updateCreditCard(card.id, { name: 'visa 2551', closingDay: 22, dueDay: 4, closingDayToNext: true, notes: undefined }),
      ).rejects.toThrow(/pagado o conciliado/)
    })
  })
})
