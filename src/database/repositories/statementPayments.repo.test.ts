import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { db } from '../db'
import { removeStatementOverride, setStatementOverride } from './cardStatements.repo'
import { createCategory } from './categories.repo'
import { createCreditCard, deleteCreditCard, updateCreditCard } from './creditCards.repo'
import { saveExpense } from './expenses.repo'
import { listStatementPayments, payStatement, undoStatementPayment } from './statementPayments.repo'

afterEach(async () => {
  await Promise.all([
    db.creditCards.clear(),
    db.cardStatements.clear(),
    db.installmentPlans.clear(),
    db.statementPayments.clear(),
    db.expenses.clear(),
    db.categories.clear(),
  ])
})

async function setup() {
  const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
  const category = await createCategory({ kind: 'expense', name: 'Varios' })
  const buy = (amount: number, currency: string) =>
    saveExpense({ date: '2026-10-10', description: 'x', categoryId: category.id, amount, currency, status: 'confirmed', cardId: card.id })
  await buy(50_000_00, 'ARS')
  await buy(30_000_00, 'ARS')
  await buy(10_00, 'USD')
  return { card }
}

describe('payStatement', () => {
  it('records what was really paid even when Moneta’s total differs — "pagado con diferencia"', async () => {
    const { statementPaymentState, statementTotals } = await import('@/domain/cards')
    const { card } = await setup()
    // The bank charged 82.000 (taxes Moneta doesn't have yet); Moneta has 80.000.
    await payStatement({
      cardId: card.id,
      period: '2026-10',
      date: '2026-11-05',
      lines: [
        { currency: 'ARS', amount: 82_000_00 },
        { currency: 'USD', amount: 10_00 },
      ],
    })
    const payments = await listStatementPayments(card.id, '2026-10')
    expect(payments.find((p) => p.currency === 'ARS')).toMatchObject({ amount: 82_000_00 })
    const expenses = await db.expenses.where('cardId').equals(card.id).toArray()
    expect(statementPaymentState(statementTotals(expenses), payments)).toEqual({
      status: 'mismatch',
      differences: [{ amount: -2_000_00, currency: 'ARS' }],
    })
  })

  it('pays each currency by its total and stores no account — and never creates a gasto', async () => {
    const { card } = await setup()
    await payStatement({
      cardId: card.id,
      period: '2026-10',
      date: '2026-11-05',
      lines: [
        { currency: 'ARS', amount: 80_000_00 },
        { currency: 'USD', amount: 10_00 },
      ],
    })
    const payments = await listStatementPayments(card.id, '2026-10')
    expect(payments.map((p) => [p.currency, p.amount])).toEqual(
      expect.arrayContaining([
        ['ARS', 80_000_00],
        ['USD', 10_00],
      ]),
    )
    for (const p of payments) {
      expect(p).not.toHaveProperty('accountId')
      expect(p).not.toHaveProperty('debitedAmount')
      expect(p).not.toHaveProperty('debitedCurrency')
    }
    expect(await db.expenses.count()).toBe(3)
  })

  it('one currency alone can be paid (the bank charged nothing in the other); the rest stays visible', async () => {
    const { card } = await setup()
    await payStatement({
      cardId: card.id,
      period: '2026-10',
      date: '2026-11-05',
      lines: [{ currency: 'ARS', amount: 80_000_00 }],
    })
    expect(await db.statementPayments.count()).toBe(1)
  })

  it('can’t pay twice; undoing lets it be paid again', async () => {
    const { card } = await setup()
    const pay = () =>
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-11-05',
        lines: [
          { currency: 'ARS', amount: 80_000_00 },
          { currency: 'USD', amount: 10_00 },
        ],
      })
    await pay()
    await expect(pay()).rejects.toThrow(/ya tiene un pago en/)
    expect(await undoStatementPayment(card.id, '2026-10')).toBe(2)
    await pay()
    expect(await db.statementPayments.count()).toBe(2)
  })

  it('a statement Moneta has empty can still be paid — the bank charged something not loaded', async () => {
    const { card } = await setup()
    await payStatement({
      cardId: card.id,
      period: '2026-12',
      date: '2026-12-26',
      lines: [{ currency: 'ARS', amount: 1_500_00 }],
    })
    expect(await listStatementPayments(card.id, '2026-12')).toHaveLength(1)
  })

})

describe('revisión de la Fase 5', () => {
  async function paid() {
    const ctx = await setup()
    await payStatement({
      cardId: ctx.card.id,
      period: '2026-10',
      date: '2026-11-05',
      lines: [
        { currency: 'ARS', amount: 80_000_00 },
        { currency: 'USD', amount: 10_00 },
      ],
    })
    return ctx
  }

  it('a statement is never paid before it closes (nor an open one)', async () => {
    const { card } = await setup()
    await expect(
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-10-20',
        lines: [
          { currency: 'ARS', amount: 80_000_00 },
          { currency: 'USD', amount: 10_00 },
        ],
      }),
    ).rejects.toThrow(/anterior al cierre/)
  })

  it('a card with paid statements can’t be deleted', async () => {
    const { card } = await paid()
    await db.expenses.where('cardId').equals(card.id).delete()
    await expect(deleteCreditCard(card.id)).rejects.toThrow(/resúmenes pagados/)
  })

  it('correcting the dates of a paid statement (or the one before it) is blocked until the payment is undone', async () => {
    const { card } = await paid()
    await expect(
      setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-10-28', dueDate: '2026-11-08' }),
    ).rejects.toThrow(/deshacé el pago/)
    await expect(
      setStatementOverride({ cardId: card.id, period: '2026-09', closeDate: '2026-09-28', dueDate: '2026-10-08' }),
    ).rejects.toThrow(/deshacé el pago/)
    await expect(removeStatementOverride(card.id, '2026-10')).rejects.toThrow(/deshacé el pago/)
    await undoStatementPayment(card.id, '2026-10')
    await setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-10-28', dueDate: '2026-11-08' })
  })

  it('changing the card’s days freezes a paid statement, even one left without gastos', async () => {
    const { card } = await paid()
    await db.expenses.where('cardId').equals(card.id).delete()
    // October already closed.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-01T12:00:00'))
    onTestFinished(() => void vi.useRealTimers())
    await updateCreditCard(card.id, { name: 'Visa', closingDay: 10, dueDay: 20, notes: undefined })
    const frozen = await db.cardStatements.where('[cardId+period]').equals([card.id, '2026-10']).first()
    expect(frozen).toMatchObject({ closeDate: '2026-10-25', dueDate: '2026-11-05' })
  })
})

describe('addStatementDifferences (Fase 6)', () => {
  it('never on an open statement; on a paid one it closes the difference with what was paid', async () => {
    const { statementPaymentState, statementTotals } = await import('@/domain/cards')
    const { addStatementDifferences } = await import('./cardStatements.repo')
    const { card } = await setup()
    const category = await db.categories.toCollection().first()
    const input = {
      cardId: card.id,
      period: '2026-10',
      categoryId: category!.id,
      description: 'Cargos',
      lines: [{ currency: 'ARS', expectedTotal: 80_000_00, bankTotal: 81_000_00 }],
    }
    // Open while today is before Oct 25 2026; closed afterwards.
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => void vi.useRealTimers())
    vi.setSystemTime(new Date('2026-10-20T12:00:00'))
    await expect(addStatementDifferences(input)).rejects.toThrow(/resumen cerrado/)
    vi.setSystemTime(new Date('2026-11-10T12:00:00'))
    await payStatement({
      cardId: card.id,
      period: '2026-10',
      date: '2026-11-05',
      lines: [
        // What the bank charged: 1.000 above Moneta's 80.000.
        { currency: 'ARS', amount: 81_000_00 },
        { currency: 'USD', amount: 10_00 },
      ],
    })
    const state = async () =>
      statementPaymentState(
        statementTotals(await db.expenses.where('cardId').equals(card.id).toArray()),
        await listStatementPayments(card.id, '2026-10'),
      ).status
    expect(await state()).toBe('mismatch')
    expect(await addStatementDifferences(input)).toBe(1)
    expect(await state()).toBe('paid')
  })
})

describe('addStatementDifferences — revisión de la Fase 6', () => {
  async function closedOctober() {
    const ctx = await setup()
    const category = await db.categories.toCollection().first()
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => void vi.useRealTimers())
    vi.setSystemTime(new Date('2026-11-10T12:00:00'))
    return { ...ctx, categoryId: category!.id }
  }

  it('one gasto per currency where the bank billed more, tagged and dated at the close', async () => {
    const { addStatementDifferences } = await import('./cardStatements.repo')
    const { card, categoryId } = await closedOctober()
    const created = await addStatementDifferences({
      cardId: card.id,
      period: '2026-10',
      categoryId,
      description: 'Cargos',
      lines: [
        { currency: 'ARS', expectedTotal: 80_000_00, bankTotal: 81_500_00 },
        { currency: 'USD', expectedTotal: 10_00, bankTotal: 12_00 },
      ],
    })
    expect(created).toBe(2)
    const charges = await db.expenses.filter((e) => e.description === 'Cargos').toArray()
    expect(charges.map((e) => [e.currency, e.amount, e.date, e.statementPeriod, e.tags])).toEqual(
      expect.arrayContaining([
        ['ARS', 1_500_00, '2026-10-25', '2026-10', ['conciliacion-resumen']],
        ['USD', 2_00, '2026-10-25', '2026-10', ['conciliacion-resumen']],
      ]),
    )
  })

  it('rejects stale totals, a bank total not above Moneta’s, and two lines of one currency', async () => {
    const { addStatementDifferences } = await import('./cardStatements.repo')
    const { card, categoryId } = await closedOctober()
    const base = { cardId: card.id, period: '2026-10', categoryId, description: 'Cargos' }
    await expect(
      addStatementDifferences({ ...base, lines: [{ currency: 'ARS', expectedTotal: 70_000_00, bankTotal: 81_000_00 }] }),
    ).rejects.toThrow(/cambió/)
    await expect(
      addStatementDifferences({ ...base, lines: [{ currency: 'ARS', expectedTotal: 80_000_00, bankTotal: 80_000_00 }] }),
    ).rejects.toThrow(/no cobró más/)
    const line = { currency: 'ARS', expectedTotal: 80_000_00, bankTotal: 81_000_00 }
    await expect(addStatementDifferences({ ...base, lines: [line, line] })).rejects.toThrow(/una sola/i)
    expect(await db.expenses.filter((e) => e.description === 'Cargos').count()).toBe(0)
  })

  it('the charge stays in its statement when its close is corrected, re-dated to the new close', async () => {
    const { addStatementDifferences } = await import('./cardStatements.repo')
    const { card, categoryId } = await closedOctober()
    await addStatementDifferences({
      cardId: card.id,
      period: '2026-10',
      categoryId,
      description: 'Cargos',
      lines: [{ currency: 'ARS', expectedTotal: 80_000_00, bankTotal: 81_000_00 }],
    })
    await setStatementOverride({ cardId: card.id, period: '2026-10', closeDate: '2026-10-23', dueDate: '2026-11-05' })
    const charge = await db.expenses.filter((e) => e.description === 'Cargos').first()
    expect(charge).toMatchObject({ statementPeriod: '2026-10', date: '2026-10-23' })
  })
})
