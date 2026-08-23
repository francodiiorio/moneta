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

export async function deleteBudget(id: string): Promise<void> {
  await db.budgets.delete(id)
}
