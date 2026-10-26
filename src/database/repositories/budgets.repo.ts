import { db } from '../db'
import type { Budget } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'

export interface CreateBudgetInput {
  categoryId: string
  currency: Budget['currency']
  period: Budget['period']
  amount: number
  startsOn: Budget['startsOn']
}

export async function listBudgets(): Promise<Budget[]> {
  return db.budgets.toArray()
}

export async function createBudget(input: CreateBudgetInput): Promise<Budget> {
  invariant(input.amount > 0, `El monto del presupuesto debe ser mayor a cero, recibido: ${input.amount}`)

  const sameStart = await db.budgets
    .where('[categoryId+startsOn]')
    .equals([input.categoryId, input.startsOn])
    .toArray()
  invariant(
    !sameStart.some((b) => b.period === input.period),
    `Ya existe un presupuesto ${input.period === 'monthly' ? 'mensual' : 'anual'} para esta categoría vigente desde ${input.startsOn}`,
  )

  const now = new Date().toISOString()
  const budget: Budget = {
    id: generateId(),
    categoryId: input.categoryId,
    currency: input.currency,
    period: input.period,
    amount: input.amount,
    startsOn: input.startsOn,
    createdAt: now,
    updatedAt: now,
  }
  await db.budgets.add(budget)
  return budget
}

/**
 * Changes a budget's amount from `startsOn` on: the version that already
 * starts that month gets the new amount (a correction); otherwise a new
 * version starts there, so earlier months keep the amount they had.
 */
export async function setBudgetAmountFrom(input: CreateBudgetInput): Promise<Budget> {
  invariant(input.amount > 0, `El monto del presupuesto debe ser mayor a cero, recibido: ${input.amount}`)
  return db.transaction('rw', db.budgets, async () => {
    const existing = (
      await db.budgets.where('[categoryId+startsOn]').equals([input.categoryId, input.startsOn]).toArray()
    ).find((b) => b.period === input.period)
    if (!existing) return createBudget(input)
    const updated: Budget = { ...existing, amount: input.amount, currency: input.currency, updatedAt: new Date().toISOString() }
    await db.budgets.put(updated)
    return updated
  })
}

export async function deleteBudget(id: string): Promise<void> {
  await db.budgets.delete(id)
}
