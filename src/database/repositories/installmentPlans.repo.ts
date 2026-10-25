import { db } from '../db'
import type { InstallmentPlan } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { minor, type CurrencyCode } from '@/domain/money'
import { buildInstallmentSchedule, installmentAmounts } from '@/domain/installments'
import { todayStamp, type DateStamp } from '@/lib/dates'
import { deleteProjectedBySourcePlanId, saveExpense } from './expenses.repo'
import { getCardCalendar } from './creditCards.repo'
import { installmentPlacement } from '@/domain/cards'

export interface CreateInstallmentPlanInput {
  description: string
  categoryId: string
  currency: CurrencyCode
  totalAmount: number
  count: number
  firstDueDate: DateStamp
  purchaseDate: DateStamp
  /** Bought with a credit card: each cuota goes into its statement. */
  cardId?: string
  /** See InstallmentPlan.startIndex: the cuotas before it aren't generated. */
  startIndex?: number
}

export async function listInstallmentPlans(): Promise<InstallmentPlan[]> {
  return db.installmentPlans.toArray()
}

/**
 * Writes the plan AND materializes its schedule — every cuota from
 * `startIndex` on — in one atomic transaction — occurrences on or before `today` go straight
 * to `confirmed`, later ones to `projected` (see docs/DECISIONS.md).
 */
export async function createInstallmentPlan(
  input: CreateInstallmentPlanInput,
  today: DateStamp = todayStamp(),
): Promise<InstallmentPlan> {
  invariant(input.totalAmount > 0, `El monto debe ser mayor a cero, recibido: ${input.totalAmount}`)
  invariant(input.count > 0, `La cantidad de cuotas debe ser mayor a cero, recibido: ${input.count}`)
  const startIndex = input.startIndex ?? 0
  invariant(
    Number.isInteger(startIndex) && startIndex >= 0 && startIndex < input.count,
    `La cuota por la que vas tiene que estar entre 1 y ${input.count}`,
  )
  // With a card the cuotas follow the purchase, one per statement: a
  // separate first-cuota date would place them somewhere else.
  invariant(
    input.cardId === undefined || input.firstDueDate === input.purchaseDate,
    'Con tarjeta, la primera cuota es la fecha de compra',
  )

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
    ...(input.cardId !== undefined && { cardId: input.cardId }),
    ...(startIndex > 0 && { startIndex }),
  }
  // A plan already under way only generates the cuotas still to come.
  const schedule = buildInstallmentSchedule(plan).filter((occurrence) => occurrence.index >= startIndex)

  const tables = [db.installmentPlans, db.expenses, db.categories, db.creditCards, db.cardStatements]
  await db.transaction('rw', tables, async () => {
    const calendar = plan.cardId !== undefined ? await getCardCalendar(plan.cardId) : undefined
    await db.installmentPlans.add(plan)
    for (const occurrence of schedule) {
      // On a card, each cuota is placed in its own statement (and dated
      // within it) — see domain/cards:installmentPlacement.
      const placement =
        calendar !== undefined ? installmentPlacement(calendar, plan.purchaseDate, occurrence.index) : undefined
      const date = placement?.date ?? occurrence.dueDate
      await saveExpense({
        date,
        description: `${plan.description} (cuota ${occurrence.index + 1}/${plan.count})`,
        categoryId: plan.categoryId,
        amount: occurrence.amount,
        currency: plan.currency,
        status: date <= today ? 'confirmed' : 'projected',
        sourcePlanId: plan.id,
        occurrenceIndex: occurrence.index,
        ...(plan.cardId !== undefined && placement !== undefined && { cardId: plan.cardId, statementPeriod: placement.period }),
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
  const tables = [db.installmentPlans, db.expenses, db.categories, db.creditCards, db.cardStatements]
  return db.transaction('rw', tables, async () => {
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
          // A card cuota keeps the date it was placed with (inside its
          // statement); the plain schedule date could fall after its close.
          date: expense.cardId !== undefined ? expense.date : occurrence.dueDate,
          description: `${plan.description} (cuota ${occurrence.index + 1}/${plan.count})`,
          categoryId: plan.categoryId,
          amount: occurrence.amount,
          currency: plan.currency,
          status: 'projected',
          sourcePlanId: plan.id,
          occurrenceIndex: occurrence.index,
          // A cuota stays in the statement it was billed in.
          ...(expense.cardId !== undefined &&
            expense.statementPeriod !== undefined && {
              cardId: expense.cardId,
              statementPeriod: expense.statementPeriod,
            }),
        },
        expense.id,
      )
    }

    return plan
  })
}
