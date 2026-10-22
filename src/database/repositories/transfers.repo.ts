import { db } from '../db'
import { transferProblem } from '@/domain/accounts'
import type { Transfer } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import type { DateStamp } from '@/lib/dates'

export interface TransferInput {
  date: DateStamp
  fromAccountId: string
  toAccountId: string
  /** Positive, in the origin account's currency, minor units. */
  fromAmount: number
  /** Positive, in the destination account's currency, minor units. */
  toAmount: number
  description: string
  notes?: string
}

export async function listTransfersInRange(startDate: string, endDate: string): Promise<Transfer[]> {
  return db.transfers.where('date').between(startDate, endDate, true, true).toArray()
}

/**
 * Validates and persists a transferencia — a full `put` on edit, same as
 * `saveExpense`/`saveIncome`. The currencies come from the accounts
 * themselves (never from the caller), and the whole thing must pass
 * `domain/accounts:transferProblem` against the accounts as they are
 * inside this same `rw` transaction.
 */
export async function saveTransfer(input: TransferInput, existingId?: string): Promise<string> {
  invariant(
    Number.isInteger(input.fromAmount) && Number.isInteger(input.toAmount),
    `Los montos deben ser enteros en unidades menores: ${input.fromAmount} / ${input.toAmount}`,
  )

  return db.transaction('rw', [db.transfers, db.accounts], async () => {
    const [from, to] = await Promise.all([db.accounts.get(input.fromAccountId), db.accounts.get(input.toAccountId)])
    invariant(from, `Cuenta no encontrada: ${input.fromAccountId}`)
    invariant(to, `Cuenta no encontrada: ${input.toAccountId}`)

    const now = new Date().toISOString()
    let createdAt = now
    if (existingId) {
      const existing = await db.transfers.get(existingId)
      invariant(existing, `No se encontró la transferencia a editar: ${existingId}`)
      createdAt = existing.createdAt
    }

    const transfer: Transfer = {
      id: existingId ?? generateId(),
      date: input.date,
      fromAccountId: from.id,
      toAccountId: to.id,
      fromAmount: input.fromAmount,
      fromCurrency: from.currency,
      toAmount: input.toAmount,
      toCurrency: to.currency,
      description: input.description,
      createdAt,
      updatedAt: now,
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    const problem = transferProblem(transfer, from, to)
    invariant(problem === undefined, problem ?? '')

    await db.transfers.put(transfer)
    return transfer.id
  })
}

export async function deleteTransfer(id: string): Promise<void> {
  await db.transfers.delete(id)
}
