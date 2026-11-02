import { db } from '../db'
import { statementDates } from '@/domain/cards'
import { invariant } from '@/lib/invariant'
import { shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import { createCategory, setCategoryArchived } from './categories.repo'
import { getCardCalendar } from './creditCards.repo'
import { setStatementOverride } from './cardStatements.repo'
import { isStatementPaid } from './statementPayments.repo'
import { saveExpense, type ExpenseInput } from './expenses.repo'
import { createInstallmentPlan, type CreateInstallmentPlanInput } from './installmentPlans.repo'

export interface StatementDatesInput {
  closeDate: DateStamp
  dueDate: DateStamp
}

export interface ApplyStatementImportInput {
  cardId: string
  /** The statement imported: its real dates, and the next one's. */
  period: MonthStamp
  dates: StatementDatesInput
  nextDates?: StatementDatesInput
  /** Gastos without a category id get this one, created when missing
   *  (the statement's taxes and charges). */
  fallbackCategoryName: string
  expenses: readonly (Omit<ExpenseInput, 'categoryId'> & { categoryId: string | undefined })[]
  plans: readonly CreateInstallmentPlanInput[]
}

/** Whether a statement's dates can no longer move: it or the next one is
 *  paid (moving its close would re-place gastos under a payment). */
export async function statementDatesLocked(cardId: string, period: MonthStamp): Promise<boolean> {
  return (await isStatementPaid(cardId, period)) || (await isStatementPaid(cardId, shiftMonth(period, 1)))
}

/**
 * Writes what a statement import selected, in one transaction — either
 * all of it lands or nothing does: the statement's real dates (and the
 * next one's) when they differ from what Moneta has — skipped for a
 * statement whose dates are locked by a payment —, then the gastos
 * (pinned to the statement) and the installment plans. Returns how many
 * gastos and plans it created, and whether some dates were left as they
 * were.
 */
export async function applyStatementImport(
  input: ApplyStatementImportInput,
  today: DateStamp = todayStamp(),
): Promise<{ expenses: number; plans: number; datesSkipped: boolean }> {
  const tables = [db.creditCards, db.cardStatements, db.expenses, db.installmentPlans, db.statementPayments, db.categories]
  return db.transaction('rw', tables, async () => {
    let datesSkipped = false
    for (const [period, dates] of [
      [input.period, input.dates],
      [shiftMonth(input.period, 1), input.nextDates],
    ] as const) {
      if (!dates) continue
      const current = statementDates(await getCardCalendar(input.cardId), period)
      if (current.closeDate === dates.closeDate && current.dueDate === dates.dueDate) continue
      if (await statementDatesLocked(input.cardId, period)) {
        datesSkipped = true
        continue
      }
      await setStatementOverride({ cardId: input.cardId, period, ...dates })
    }

    let fallbackId: string | undefined
    async function fallbackCategory(): Promise<string> {
      if (fallbackId) return fallbackId
      const existing = await db.categories.filter((c) => c.kind === 'expense' && c.name === input.fallbackCategoryName).first()
      // An archived one comes back rather than a second category with its name.
      if (existing?.isArchived) await setCategoryArchived(existing.id, false)
      fallbackId = existing?.id ?? (await createCategory({ kind: 'expense', name: input.fallbackCategoryName })).id
      return fallbackId
    }

    for (const expense of input.expenses) {
      invariant(expense.cardId === input.cardId, 'Un gasto importado tiene que ser de la tarjeta del resumen')
      await saveExpense({ ...expense, categoryId: expense.categoryId ?? (await fallbackCategory()) })
    }
    for (const plan of input.plans) {
      invariant(plan.cardId === input.cardId, 'Una compra en cuotas importada tiene que ser de la tarjeta del resumen')
      await createInstallmentPlan(plan, today)
    }
    return { expenses: input.expenses.length, plans: input.plans.length, datesSkipped }
  })
}
