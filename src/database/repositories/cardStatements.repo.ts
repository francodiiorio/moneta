import { db } from '../db'
import { statementOverrideProblem } from '@/domain/cards'
import type { CardStatement, Expense } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import type { DateStamp, MonthStamp } from '@/lib/dates'
import { getCardCalendar, reassignCardExpenses } from './creditCards.repo'
import { assertCloseCanMove } from './statementPayments.repo'

/** Expenses of one card, newest first — optionally only one statement. */
export async function listCardExpenses(cardId: string, period?: MonthStamp): Promise<Expense[]> {
  const expenses =
    period === undefined
      ? await db.expenses.where('cardId').equals(cardId).toArray()
      : await db.expenses.where('[cardId+statementPeriod]').equals([cardId, period]).toArray()
  expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  return expenses
}

export interface StatementOverrideInput {
  cardId: string
  period: MonthStamp
  closeDate: DateStamp
  dueDate: DateStamp
}

/**
 * Records a period's real close/due dates (what the bank published) and
 * re-places the card's automatically placed expenses accordingly, in one
 * transaction. Returns how many expenses moved to another statement.
 */
export async function setStatementOverride(input: StatementOverrideInput): Promise<number> {
  const tables = [db.creditCards, db.cardStatements, db.expenses, db.installmentPlans, db.statementPayments]
  return db.transaction('rw', tables, async () => {
    await assertCloseCanMove(input.cardId, input.period)
    const before = await getCardCalendar(input.cardId)
    const problem = statementOverrideProblem(before, input.period, input.closeDate, input.dueDate)
    invariant(problem === undefined, problem ?? '')
    const existing = await db.cardStatements.where('[cardId+period]').equals([input.cardId, input.period]).first()
    const now = new Date().toISOString()
    const statement: CardStatement = {
      id: existing?.id ?? generateId(),
      cardId: input.cardId,
      period: input.period,
      closeDate: input.closeDate,
      dueDate: input.dueDate,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await db.cardStatements.put(statement)
    return reassignCardExpenses(input.cardId, before, await getCardCalendar(input.cardId))
  })
}

/** Goes back to the card's default days for `period`. */
export async function removeStatementOverride(cardId: string, period: MonthStamp): Promise<number> {
  const tables = [db.creditCards, db.cardStatements, db.expenses, db.installmentPlans, db.statementPayments]
  return db.transaction('rw', tables, async () => {
    await assertCloseCanMove(cardId, period)
    const before = await getCardCalendar(cardId)
    await db.cardStatements.where('[cardId+period]').equals([cardId, period]).delete()
    return reassignCardExpenses(cardId, before, await getCardCalendar(cardId))
  })
}
