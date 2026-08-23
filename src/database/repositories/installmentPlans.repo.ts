import { db } from '../db'
import type { InstallmentPlan } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { buildExpense } from '@/domain/ledger'
import { minor, money, type CurrencyCode } from '@/domain/money'
import { buildInstallmentSchedule, installmentAmounts } from '@/domain/installments'
import { todayStamp, type DateStamp } from '@/lib/dates'
import { deleteProjectedBySourcePlanId, writeLedgerEntry } from './transactions.repo'

export interface CreateInstallmentPlanInput {
  description: string
  accountId: string
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
    accountId: input.accountId,
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

  await db.transaction('rw', db.installmentPlans, db.transactions, db.postings, db.accounts, async () => {
    await db.installmentPlans.add(plan)
    for (const occurrence of schedule) {
      await writeLedgerEntry(
        buildExpense({
          date: occurrence.dueDate,
          description: `${plan.description} (cuota ${occurrence.index + 1}/${plan.count})`,
          accountId: plan.accountId,
          categoryId: plan.categoryId,
          amount: money(occurrence.amount, plan.currency),
          status: occurrence.dueDate <= today ? 'confirmed' : 'projected',
          sourcePlanId: plan.id,
          occurrenceIndex: occurrence.index,
        }),
      )
    }
  })

  return plan
}

/** Deletes the plan and its still-`projected` cuotas; `confirmed` ones —
 *  cuotas that already happened — are historical fact and stay put. */
export async function deleteInstallmentPlan(id: string): Promise<void> {
  await db.transaction('rw', db.installmentPlans, db.transactions, db.postings, async () => {
    await deleteProjectedBySourcePlanId(id)
    await db.installmentPlans.delete(id)
  })
}
