import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { db } from '../db'
import { createAccount, listAccountMovementRecords, updateAccount } from './accounts.repo'
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
    db.accounts.clear(),
  ])
})

async function setup() {
  const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
  const category = await createCategory({ kind: 'expense', name: 'Varios' })
  const base = { type: 'bank' as const, openingBalance: 0, openingDate: '2026-01-01' }
  const pesos = await createAccount({ ...base, name: 'Galicia', currency: 'ARS' })
  const dollars = await createAccount({ ...base, name: 'Caja USD', currency: 'USD' })
  const buy = (amount: number, currency: string) =>
    saveExpense({ date: '2026-10-10', description: 'x', categoryId: category.id, amount, currency, status: 'confirmed', cardId: card.id })
  await buy(50_000_00, 'ARS')
  await buy(30_000_00, 'ARS')
  await buy(10_00, 'USD')
  return { card, pesos, dollars }
}

describe('payStatement', () => {
  it('rejects when the total changed since the user saw it', async () => {
    const { card, pesos, dollars } = await setup()
    await expect(
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-11-05',
        lines: [
          { currency: 'ARS', expectedAmount: 50_000_00, accountId: pesos.id, expectedAccountCurrency: 'ARS' },
          { currency: 'USD', expectedAmount: 10_00, accountId: dollars.id, expectedAccountCurrency: 'USD' },
        ],
      }),
    ).rejects.toThrow(/cambió/)
  })

  it('a cross-currency line needs the debited amount', async () => {
    const { card, pesos } = await setup()
    await expect(
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-11-05',
        lines: [
          { currency: 'ARS', expectedAmount: 80_000_00, accountId: pesos.id, expectedAccountCurrency: 'ARS' },
          { currency: 'USD', expectedAmount: 10_00, accountId: pesos.id, expectedAccountCurrency: 'ARS' },
        ],
      }),
    ).rejects.toThrow(/cuánto se debitó/)
  })

  it('pays each currency by its total, from an account in that currency or another (with both real amounts)', async () => {
    const { card, pesos } = await setup()
    await payStatement({
      cardId: card.id,
      period: '2026-10',
      date: '2026-11-05',
      lines: [
        { currency: 'ARS', expectedAmount: 80_000_00, accountId: pesos.id, debitedAmount: 80_000_00, expectedAccountCurrency: 'ARS' },
        // The dollars, paid from the peso account at the bank's rate.
        { currency: 'USD', expectedAmount: 10_00, accountId: pesos.id, debitedAmount: 12_500_00, expectedAccountCurrency: 'ARS' },
      ],
    })
    const payments = await listStatementPayments(card.id, '2026-10')
    expect(payments.map((p) => [p.currency, p.amount, p.debitedAmount, p.debitedCurrency])).toEqual(
      expect.arrayContaining([
        ['ARS', 80_000_00, 80_000_00, 'ARS'],
        ['USD', 10_00, 12_500_00, 'ARS'],
      ]),
    )
    // It's a movement of the account — never a gasto.
    expect((await listAccountMovementRecords()).statementPayments).toHaveLength(2)
    expect(await db.expenses.count()).toBe(3)
  })

  it('only full payment: every currency of the statement must be paid', async () => {
    const { card, pesos } = await setup()
    await expect(
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-11-05',
        lines: [{ currency: 'ARS', expectedAmount: 80_000_00, accountId: pesos.id, debitedAmount: 80_000_00, expectedAccountCurrency: 'ARS' }],
      }),
    ).rejects.toThrow(/completo/)
    expect(await db.statementPayments.count()).toBe(0)
  })

  it('a same-currency line must debit exactly the total', async () => {
    const { card, pesos, dollars } = await setup()
    await expect(
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-11-05',
        lines: [
          { currency: 'ARS', expectedAmount: 80_000_00, accountId: pesos.id, debitedAmount: 70_000_00, expectedAccountCurrency: 'ARS' },
          { currency: 'USD', expectedAmount: 10_00, accountId: dollars.id, expectedAccountCurrency: 'USD' },
        ],
      }),
    ).rejects.toThrow(/misma moneda/)
  })

  it('can’t pay twice; undoing gives the debits back', async () => {
    const { card, pesos, dollars } = await setup()
    const pay = () =>
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-11-05',
        lines: [
          { currency: 'ARS', expectedAmount: 80_000_00, accountId: pesos.id, debitedAmount: 80_000_00, expectedAccountCurrency: 'ARS' },
          { currency: 'USD', expectedAmount: 10_00, accountId: dollars.id, expectedAccountCurrency: 'USD' },
        ],
      })
    await pay()
    await expect(pay()).rejects.toThrow(/ya está pagado/)
    expect(await undoStatementPayment(card.id, '2026-10')).toBe(2)
    await pay()
    expect(await db.statementPayments.count()).toBe(2)
  })

  it('an empty statement has nothing to pay', async () => {
    const { card, pesos } = await setup()
    await expect(
      payStatement({
        cardId: card.id,
        period: '2026-12',
        date: '2026-12-26',
        lines: [{ currency: 'ARS', expectedAmount: 1, accountId: pesos.id, debitedAmount: 1, expectedAccountCurrency: 'ARS' }],
      }),
    ).rejects.toThrow(/no tiene gastos/)
  })

  it('a paid statement blocks deleting its account (it is a movement)', async () => {
    const { deleteAccount } = await import('./accounts.repo')
    const { card, pesos, dollars } = await setup()
    await payStatement({
      cardId: card.id,
      period: '2026-10',
      date: '2026-11-05',
      lines: [
        { currency: 'ARS', expectedAmount: 80_000_00, accountId: pesos.id, debitedAmount: 80_000_00, expectedAccountCurrency: 'ARS' },
        { currency: 'USD', expectedAmount: 10_00, accountId: dollars.id, expectedAccountCurrency: 'USD' },
      ],
    })
    await expect(deleteAccount(dollars.id)).rejects.toThrow(/archivala/)
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
        { currency: 'ARS', expectedAmount: 80_000_00, accountId: ctx.pesos.id, expectedAccountCurrency: 'ARS' },
        { currency: 'USD', expectedAmount: 10_00, accountId: ctx.dollars.id, expectedAccountCurrency: 'USD' },
      ],
    })
    return ctx
  }

  it('a statement is never paid before it closes (nor an open one)', async () => {
    const { card, pesos, dollars } = await setup()
    await expect(
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-10-20',
        lines: [
          { currency: 'ARS', expectedAmount: 80_000_00, accountId: pesos.id, expectedAccountCurrency: 'ARS' },
          { currency: 'USD', expectedAmount: 10_00, accountId: dollars.id, expectedAccountCurrency: 'USD' },
        ],
      }),
    ).rejects.toThrow(/anterior al cierre/)
  })

  it('rejects when an account’s currency changed since the form showed it', async () => {
    const { card, pesos, dollars } = await setup()
    await expect(
      payStatement({
        cardId: card.id,
        period: '2026-10',
        date: '2026-11-05',
        lines: [
          { currency: 'ARS', expectedAmount: 80_000_00, accountId: pesos.id, expectedAccountCurrency: 'USD', debitedAmount: 70_00 },
          { currency: 'USD', expectedAmount: 10_00, accountId: dollars.id, expectedAccountCurrency: 'USD' },
        ],
      }),
    ).rejects.toThrow(/moneda de una cuenta cambió/)
  })

  it('a card with paid statements can’t be deleted', async () => {
    const { card } = await paid()
    await db.expenses.where('cardId').equals(card.id).delete()
    await expect(deleteCreditCard(card.id)).rejects.toThrow(/resúmenes pagados/)
  })

  it('the paying account can’t change currency nor move its opening past the payment', async () => {
    const { dollars } = await paid()
    const base = { name: 'Caja USD', type: 'bank' as const, openingBalance: 0, notes: undefined }
    await expect(updateAccount(dollars.id, { ...base, currency: 'EUR', openingDate: '2026-01-01' })).rejects.toThrow()
    await expect(updateAccount(dollars.id, { ...base, currency: 'USD', openingDate: '2026-11-06' })).rejects.toThrow()
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
