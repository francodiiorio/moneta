import Dexie from 'dexie'
import { db } from '../db'
import type { Expense } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
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
 * transaction a caller (bulkSaveExpenses, installmentPlans.repo.ts,
 * recurringPlans.repo.ts) already has open on `db.expenses`, so this is
 * free for them.
 */
export async function saveExpense(input: ExpenseInput, existingId?: string): Promise<string> {
  invariant(input.amount > 0, `El monto debe ser mayor a cero, recibido: ${input.amount}`)

  return db.transaction('rw', db.expenses, async () => {
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
    }
    await db.expenses.put(expense)
    return id
  })
}

/**
 * Writes every input in `inputs` atomically — one Dexie `rw` transaction
 * covering all of them, so a bulk import (CSV, etc.) either lands
 * entirely or not at all, same guarantee as every other multi-write in
 * this repo.
 */
export async function bulkSaveExpenses(inputs: readonly ExpenseInput[]): Promise<void> {
  await db.transaction('rw', db.expenses, async () => {
    for (const input of inputs) {
      await saveExpense(input)
    }
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
