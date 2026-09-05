import { db } from '../db'
import type { InstallmentPlan } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { minor, type CurrencyCode } from '@/domain/money'
import { buildInstallmentSchedule, installmentAmounts } from '@/domain/installments'
import { todayStamp, type DateStamp } from '@/lib/dates'
import { deleteProjectedBySourcePlanId, saveExpense } from './expenses.repo'

export interface CreateInstallmentPlanInput {
  description: string
  categoryId: string
  currency: CurrencyCode
  totalAmount: number
  count: number
  firstDueDate: DateStamp
  purchaseDate: DateStamp
}

export async function listInstallmentPlans(): Promise<InstallmentPlan[]> {
  return db.installmentPlans.toArray()
}

/**
 * Writes the plan AND materializes its full schedule of N occurrences in
 * one atomic transaction — occurrences on or before `today` go straight
 * to `confirmed`, later ones to `projected` (see docs/DECISIONS.md).
 */
export async function createInstallmentPlan(
  input: CreateInstallmentPlanInput,
  today: DateStamp = todayStamp(),
): Promise<InstallmentPlan> {
  invariant(input.totalAmount > 0, `El monto debe ser mayor a cero, recibido: ${input.totalAmount}`)
  invariant(input.count > 0, `La cantidad de cuotas debe ser mayor a cero, recibido: ${input.count}`)

  const now = new Date().toISOString()
  const plan: InstallmentPlan = {
    id: generateId(),
    description: input.description,
    categoryId: input.categoryId,
    currency: input.currency,
    totalAmount: input.totalAmount,
    count: input.count,
    firstDueDate: input.firstDueDate,
    purchaseDate: input.purchaseDate,
    scheduleCache: installmentAmounts(minor(input.totalAmount), input.count),
    createdAt: now,
    updatedAt: now,
  }
  const schedule = buildInstallmentSchedule(plan)

  await db.transaction('rw', db.installmentPlans, db.expenses, async () => {
    await db.installmentPlans.add(plan)
    for (const occurrence of schedule) {
      await saveExpense({
        date: occurrence.dueDate,
        description: `${plan.description} (cuota ${occurrence.index + 1}/${plan.count})`,
        categoryId: plan.categoryId,
        amount: occurrence.amount,
        currency: plan.currency,
        status: occurrence.dueDate <= today ? 'confirmed' : 'projected',
        sourcePlanId: plan.id,
        occurrenceIndex: occurrence.index,
      })
    }
  })

  return plan
}

/** Deletes the plan and its still-`projected` cuotas; `confirmed` ones —
 *  cuotas that already happened — are historical fact and stay put. */
export async function deleteInstallmentPlan(id: string): Promise<void> {
  await db.transaction('rw', db.installmentPlans, db.expenses, async () => {
    await deleteProjectedBySourcePlanId(id)
    await db.installmentPlans.delete(id)
  })
}

export interface UpdateInstallmentPlanInput {
  description: string
  categoryId: string
}

/**
 * Editing an installment plan is deliberately narrow: description and
 * category only — never totalAmount/count/dates/currency. Those feed
 * `scheduleCache` (frozen at creation via `allocate`) and every cuota's
 * `Expense` is written upfront, `confirmed` ones included; recomputing
 * the split after the fact would leave `listInstallmentPlansWithProgress`
 * reading confirmed amounts off a `scheduleCache` that no longer matches
 * what those expenses actually record (see docs/DECISIONS.md). To change
 * the amount, number of cuotas or currency, delete and recreate the plan.
 *
 * Only still-`projected` cuotas are rewritten in place (same category and
 * description as the plan) — `confirmed` ones are untouched, same
 * historical-immutability rule as `deleteInstallmentPlan`.
 */
export async function updateInstallmentPlan(id: string, input: UpdateInstallmentPlanInput): Promise<InstallmentPlan> {
  return db.transaction('rw', db.installmentPlans, db.expenses, async () => {
    const existing = await db.installmentPlans.get(id)
    invariant(existing, `No se encontró la compra en cuotas: ${id}`)

    const plan: InstallmentPlan = {
      ...existing,
      description: input.description,
      categoryId: input.categoryId,
      updatedAt: new Date().toISOString(),
    }
    await db.installmentPlans.put(plan)

    const schedule = buildInstallmentSchedule(plan)
    const scheduleByIndex = new Map(schedule.map((occurrence) => [occurrence.index, occurrence]))

    const projected = await db.expenses
      .where('sourcePlanId')
      .equals(id)
      .filter((e) => e.status === 'projected')
      .toArray()

    for (const expense of projected) {
      const occurrence = scheduleByIndex.get(expense.occurrenceIndex ?? -1)
      invariant(occurrence, `No se encontró la cuota ${String(expense.occurrenceIndex)} en el cronograma`)
      await saveExpense(
        {
          date: occurrence.dueDate,
          description: `${plan.description} (cuota ${occurrence.index + 1}/${plan.count})`,
          categoryId: plan.categoryId,
          amount: occurrence.amount,
          currency: plan.currency,
          status: 'projected',
          sourcePlanId: plan.id,
          occurrenceIndex: occurrence.index,
        },
        expense.id,
      )
    }

    return plan
  })
}
