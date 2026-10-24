import { db } from '../db'
import { statementDates, statementDifferences, statementOverrideProblem, statementPeriodFor, statementTotals } from '@/domain/cards'
import { money } from '@/domain/money'
import type { CardStatement, Expense } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import { getCardCalendar, reassignCardExpenses, STATEMENT_RECONCILE_TAG } from './creditCards.repo'
import { assertCloseCanMove, isStatementPaid } from './statementPayments.repo'
import { saveExpense } from './expenses.repo'

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


export interface StatementDifferenceInput {
  cardId: string
  period: MonthStamp
  categoryId: string
  description: string
  lines: readonly {
    currency: string
    /** Moneta's total the user saw — rejected if it changed since. */
    expectedTotal: number
    /** The bank's total; must be above `expectedTotal`. */
    bankTotal: number
  }[]
}

/**
 * Reconciling a closed, unpaid statement against the bank's: what the
 * bank billed above Moneta's total (taxes, interest, fees) becomes a gasto
 * in that statement, dated at its close — one per currency, so the totals
 * then match and the statement can be paid in full. Never for a paid
 * statement (it would leave it "paid with a difference"). Returns how many
 * gastos it created.
 */
export async function addStatementDifferences(input: StatementDifferenceInput): Promise<number> {
  const tables = [db.expenses, db.categories, db.creditCards, db.cardStatements, db.statementPayments]
  return db.transaction('rw', tables, async () => {
    const calendar = await getCardCalendar(input.cardId)
    invariant(statementPeriodFor(calendar, todayStamp()) > input.period, 'Sólo se concilia un resumen cerrado')
    invariant(!(await isStatementPaid(input.cardId, input.period)), 'Ese resumen ya está pagado — deshacé el pago para conciliarlo')
    const currencies = new Set(input.lines.map((l) => l.currency))
    invariant(currencies.size === input.lines.length, 'Una sola diferencia por moneda')
    const totals = statementTotals(await listCardExpenses(input.cardId, input.period))
    const { closeDate } = statementDates(calendar, input.period)
    for (const line of input.lines) {
      invariant(
        Number.isSafeInteger(line.bankTotal) && Number.isSafeInteger(line.expectedTotal),
        `Los totales deben ser enteros en unidades menores: ${line.bankTotal} / ${line.expectedTotal}`,
      )
      invariant(
        (totals.find((t) => t.currency === line.currency)?.amount ?? 0) === line.expectedTotal,
        'El total del resumen cambió mientras conciliabas — cerrá y volvé a abrir la conciliación',
      )
      const [difference] = statementDifferences(totals, [money(line.bankTotal, line.currency)])
      invariant(difference && difference.amount > 0, `El banco no cobró más que Moneta en ${line.currency}`)
      await saveExpense({
        date: closeDate,
        description: input.description,
        categoryId: input.categoryId,
        amount: difference.amount,
        currency: line.currency,
        status: 'confirmed',
        cardId: input.cardId,
        statementPeriod: input.period,
        tags: [STATEMENT_RECONCILE_TAG],
      })
    }
    return input.lines.length
  })
}
