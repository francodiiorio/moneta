import { db } from '../db'
import type { SavingsHolding } from '@/domain/entities'
import { generateId } from '@/lib/ids'

export interface CreateSavingsHoldingInput {
  name: string
  currency: SavingsHolding['currency']
  amount: SavingsHolding['amount']
  location?: string
  notes?: string
}

export type UpdateSavingsHoldingInput = Partial<
  Pick<SavingsHolding, 'name' | 'currency' | 'amount' | 'location' | 'notes'>
>

export async function listSavingsHoldings(): Promise<SavingsHolding[]> {
  return db.savingsHoldings.toArray()
}

export async function createSavingsHolding(input: CreateSavingsHoldingInput): Promise<SavingsHolding> {
  const now = new Date().toISOString()
  const holding: SavingsHolding = {
    id: generateId(),
    name: input.name,
    currency: input.currency,
    amount: input.amount,
    createdAt: now,
    updatedAt: now,
    ...(input.location !== undefined && { location: input.location }),
    ...(input.notes !== undefined && { notes: input.notes }),
  }
  await db.savingsHoldings.add(holding)
  return holding
}

export async function updateSavingsHolding(id: string, patch: UpdateSavingsHoldingInput): Promise<void> {
  await db.savingsHoldings.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteSavingsHolding(id: string): Promise<void> {
  await db.savingsHoldings.delete(id)
}
