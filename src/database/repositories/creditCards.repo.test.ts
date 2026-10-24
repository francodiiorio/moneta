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
    const { card, category } = await setup()
    const id = await saveExpense(purchase(category.id, card.id, { date: '2026-10-24' }))
    await updateCreditCard(card.id, { name: 'Visa', closingDay: 20, dueDay: 5, notes: undefined })
    expect((await db.expenses.get(id))?.statementPeriod).toBe('2026-11')
    expect(await listCardExpenses(card.id, '2026-11')).toHaveLength(1)
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
