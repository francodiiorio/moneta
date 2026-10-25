import Dexie from 'dexie'
import { db } from '../db'
import type { Expense } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { assertAccountAccepts } from './accounts.repo'
import { getCardCalendar } from './creditCards.repo'
import { statementDates, statementPeriodFor } from '@/domain/cards'
import { isValidMonthStamp, todayStamp, type MonthStamp } from '@/lib/dates'
import type { CurrencyCode } from '@/domain/money'
import type { DateStamp } from '@/lib/dates'

export interface ExpenseInput {
  date: DateStamp
  description: string
  categoryId: string
  amount: number
  currency: CurrencyCode
  status: Expense['status']
  notes?: string
  tags?: string[]
  sourcePlanId?: string
  occurrenceIndex?: number
  /** Debit only — the gasto left this account (see domain/accounts). */
  accountId?: string
  /** Credit card — mutually exclusive with `accountId`. */
  cardId?: string
  /** The statement it's billed in. Omitted with a `cardId`: placed
   *  automatically by the card's calendar (domain/cards:statementPeriodFor);
   *  given: pinned there (a late presentation, an installment). */
  statementPeriod?: MonthStamp
}

export async function countExpenses(): Promise<number> {
  return db.expenses.count()
}

export async function listExpensesInRange(startDate: string, endDate: string): Promise<Expense[]> {
  const expenses = await db.expenses.where('date').between(startDate, endDate, true, true).toArray()
  expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  return expenses
}

/**
 * Validates and persists a gasto. When `existingId` is given, every field
 * is overwritten wholesale (a full `put`, not a patch) — simpler than
 * diffing, and consistent with how the old ledger's `writeLedgerEntry`
 * replaced a transaction's postings wholesale on edit.
 *
 * The existing-row read and the `put` run inside one `rw` transaction —
 * without it, a concurrent `deleteExpense` for the same id between the two
 * could "resurrect" a gasto the user just deleted, with a `createdAt` read
 * from a row that no longer exists. Dexie joins this into whatever
 * transaction a caller (imports.repo.ts, installmentPlans.repo.ts,
 * recurringPlans.repo.ts) already has open on `db.expenses`, so this is
 * free for them.
 *
 * The category must be a gasto category — the same rule backup import
 * enforces (`validateLedgerIntegrity`), so the app can never write a gasto
 * that its own backup would then refuse to restore. That's why every
 * parent transaction above also covers `db.categories`.
 *
 * `db.accounts` joins the scope only when the gasto has an `accountId`,
 * and the card tables only with a `cardId`: the plan repos' parent
 * transactions don't cover them, and Dexie rejects a nested transaction
 * that asks for a table its parent doesn't have — plans never set either
 * (Etapa 8), so they keep nesting fine.
 */
export async function saveExpense(input: ExpenseInput, existingId?: string): Promise<string> {
  invariant(input.amount > 0, `El monto debe ser mayor a cero, recibido: ${input.amount}`)

  invariant(
    input.accountId === undefined || input.cardId === undefined,
    'Un gasto se paga con débito o con tarjeta, no con los dos',
  )
  invariant(input.cardId !== undefined || input.statementPeriod === undefined, 'Un resumen necesita una tarjeta')
  invariant(
    input.statementPeriod === undefined || isValidMonthStamp(input.statementPeriod),
    `Resumen inválido: ${input.statementPeriod}`,
  )

  const tables = [
    db.expenses,
    db.categories,
    ...(input.accountId !== undefined ? [db.accounts] : []),
    ...(input.cardId !== undefined ? [db.creditCards, db.cardStatements] : []),
  ]
  return db.transaction('rw', tables, async () => {
    const category = await db.categories.get(input.categoryId)
    invariant(category, `Categoría no encontrada: ${input.categoryId}`)
    invariant(category.kind === 'expense', `"${category.name}" no es una categoría de gasto`)
    if (input.accountId !== undefined) await assertAccountAccepts(input.accountId, input)
    let statementPeriod: MonthStamp | undefined
    if (input.cardId !== undefined) {
      // Always read: it's also what checks the card still exists, even
      // when the period comes pinned.
      const calendar = await getCardCalendar(input.cardId)
      const automatic = statementPeriodFor(calendar, input.date)
      statementPeriod = input.statementPeriod ?? automatic
      if (existingId && input.statementPeriod !== undefined) {
        // An edit that keeps the statement the gasto had, where that was
        // simply its automatic one and that statement is still open: the
        // form only echoed it back, so follow the (maybe corrected) date —
        // otherwise fixing a typo in the date would pin it to the old
        // statement forever. A closed statement never moves.
        const existing = await db.expenses.get(existingId)
        const wasAutomatic =
          existing?.cardId === input.cardId &&
          existing.statementPeriod === input.statementPeriod &&
          existing.statementPeriod === statementPeriodFor(calendar, existing.date)
        const stillOpen = statementDates(calendar, input.statementPeriod).closeDate >= todayStamp()
        if (wasAutomatic && stillOpen) statementPeriod = automatic
      }
      invariant(statementPeriod >= automatic, 'Ese resumen cerró antes de la fecha del gasto')
    }
    const now = new Date().toISOString()
    const id = existingId ?? generateId()

    let createdAt = now
    if (existingId) {
      const existing = await db.expenses.get(existingId)
      invariant(existing, `No se encontró el gasto a editar: ${existingId}`)
      createdAt = existing.createdAt
    }

    const expense: Expense = {
      id,
      date: input.date,
      amount: input.amount,
      currency: input.currency,
      categoryId: input.categoryId,
      description: input.description,
      status: input.status,
      createdAt,
      updatedAt: now,
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.sourcePlanId !== undefined && { sourcePlanId: input.sourcePlanId }),
      ...(input.occurrenceIndex !== undefined && { occurrenceIndex: input.occurrenceIndex }),
      ...(input.accountId !== undefined && { accountId: input.accountId }),
      ...(input.cardId !== undefined && statementPeriod !== undefined && { cardId: input.cardId, statementPeriod }),
    }
    await db.expenses.put(expense)
    return id
  })
}

export async function deleteExpense(id: string): Promise<void> {
  await db.expenses.delete(id)
}

/** Every expense materialized from a plan (i.e. `sourcePlanId` set) —
 *  Dexie excludes `undefined` keys from an index, so this is a direct
 *  index scan, not a full-table one. Used to compute installment plan
 *  progress. */
export async function listPlanExpenses(): Promise<Expense[]> {
  return db.expenses.where('sourcePlanId').above(Dexie.minKey).toArray()
}

/**
 * Deletes only the still-`projected` expenses for a plan — `confirmed`
 * ones already happened and are left untouched. Used by
 * installmentPlans.repo.ts's `deleteInstallmentPlan`.
 */
export async function deleteProjectedBySourcePlanId(sourcePlanId: string): Promise<void> {
  const projectedIds = await db.expenses
    .where('sourcePlanId')
    .equals(sourcePlanId)
    .filter((e) => e.status === 'projected')
    .primaryKeys()
  if (projectedIds.length === 0) return
  await db.expenses.bulkDelete(projectedIds)
}

/**
 * Deletes every expense materialized from a plan, `confirmed` ones
 * included — unlike `deleteProjectedBySourcePlanId`, which only ever
 * touches not-yet-real ones. Only for the explicit "also delete what this
 * plan already generated" choice when removing a plan (see
 * recurringPlans.repo.ts's `deleteRecurringPlan`); never called as a side
 * effect of anything else, since it erases real financial history.
 */
export async function deleteAllBySourcePlanId(sourcePlanId: string): Promise<void> {
  const ids = await db.expenses.where('sourcePlanId').equals(sourcePlanId).primaryKeys()
  if (ids.length === 0) return
  await db.expenses.bulkDelete(ids)
}

/**
 * Promotes every `projected` expense whose date has arrived (`<= today`)
 * to `confirmed` — from that point on it counts toward reports/budgets
 * (both already filter by `status === 'confirmed'`). Idempotent: nothing
 * is left in `projected` state for a date once this has run for it, so
 * re-running finds nothing more to promote.
 */
export async function confirmDueProjected(today: DateStamp): Promise<number> {
  return db.expenses
    .where('[status+date]')
    .between(['projected', Dexie.minKey], ['projected', today], true, true)
    .modify({ status: 'confirmed' })
}
