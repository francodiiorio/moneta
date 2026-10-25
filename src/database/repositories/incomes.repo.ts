import { db } from '../db'
import type { Income } from '@/domain/entities'
import type { CurrencyCode } from '@/domain/money'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import type { DateStamp } from '@/lib/dates'
import { assertAccountAccepts } from './accounts.repo'

export interface IncomeInput {
  date: DateStamp
  description: string
  categoryId: string
  accountId: string
  amount: number
  currency: CurrencyCode
  notes?: string
}

export async function countIncomes(): Promise<number> {
  return db.incomes.count()
}

export async function listIncomesInRange(startDate: string, endDate: string): Promise<Income[]> {
  const incomes = await db.incomes.where('date').between(startDate, endDate, true, true).toArray()
  incomes.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  return incomes
}

/**
 * Validates and persists an ingreso — a full `put` on edit, same as
 * `saveExpense`. Beyond a positive amount, an ingreso must go into an
 * account that accepts it (same currency, not before its opening date)
 * and use an income category: a gasto category here would make it show
 * up in expense reports/budgets under the wrong sign.
 */
export async function saveIncome(input: IncomeInput, existingId?: string): Promise<string> {
  invariant(input.amount > 0, `El monto debe ser mayor a cero, recibido: ${input.amount}`)
  invariant(Number.isInteger(input.amount), `El monto debe ser un entero en unidades menores: ${input.amount}`)

  return db.transaction('rw', [db.incomes, db.accounts, db.categories], async () => {
    await assertAccountAccepts(input.accountId, input)
    const category = await db.categories.get(input.categoryId)
    invariant(category, `Categoría no encontrada: ${input.categoryId}`)
    invariant(category.kind === 'income', `"${category.name}" no es una categoría de ingreso`)

    const now = new Date().toISOString()
    const id = existingId ?? generateId()
    let createdAt = now
    if (existingId) {
      const existing = await db.incomes.get(existingId)
      invariant(existing, `No se encontró el ingreso a editar: ${existingId}`)
      createdAt = existing.createdAt
    }

    const income: Income = {
      id,
      date: input.date,
      amount: input.amount,
      currency: input.currency,
      accountId: input.accountId,
      categoryId: input.categoryId,
      description: input.description,
      createdAt,
      updatedAt: now,
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    await db.incomes.put(income)
    return id
  })
}

export async function deleteIncome(id: string): Promise<void> {
  await db.incomes.delete(id)
}
