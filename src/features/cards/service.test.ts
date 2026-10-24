import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createCategory } from '@/database/repositories/categories.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import { money } from '@/domain/money'
import {
  correctStatementDates,
  createCardFromForm,
  getOpenPeriod,
  getStatementDetail,
  listCardSummaries,
  resetStatementDates,
  statementChoices,
  updateCardFromForm,
} from './service'

afterEach(async () => {
  await Promise.all([db.creditCards.clear(), db.cardStatements.clear(), db.expenses.clear(), db.categories.clear()])
})

async function seed() {
  const card = await createCardFromForm({ name: 'Visa', closingDay: '25', dueDay: '5', notes: '' })
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
    const card = await createCardFromForm({ name: 'Visa', closingDay: '25', dueDay: '5', notes: '' })
    expect((await statementChoices(card.id, '2026-10-26')).map((c) => c.period)).toEqual(['2026-11', '2026-12', '2027-01'])
  })

  it('getOpenPeriod is null for a card that does not exist', async () => {
    expect(await getOpenPeriod('ghost')).toBeNull()
  })

  it('editing clears notes when left empty, and corrected dates can be reset', async () => {
    const card = await createCardFromForm({ name: 'Visa', closingDay: '25', dueDay: '5', notes: 'vieja' })
    await updateCardFromForm(card.id, { name: 'Visa', closingDay: '25', dueDay: '5', notes: '' })
    expect((await db.creditCards.get(card.id))?.notes).toBeUndefined()

    await correctStatementDates(card.id, '2026-10', { closeDate: '2026-10-22', dueDate: '2026-11-03' })
    await resetStatementDates(card.id, '2026-10')
    expect(await db.cardStatements.count()).toBe(0)
  })
})
