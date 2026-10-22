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
  /** The currencies the caller parsed `fromAmount`/`toAmount` in. Checked
   *  against the accounts inside the write transaction: amounts are bare
   *  integers, so if an account's currency changed between the caller's
   *  read and this write (another tab, an account with no movements yet),
   *  the same integer would silently mean a different amount. */
  expectedFromCurrency: string
  expectedToCurrency: string
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
    invariant(
      from.currency === input.expectedFromCurrency && to.currency === input.expectedToCurrency,
      'La moneda de una de las cuentas cambió mientras cargabas la transferencia — volvé a intentarlo',
    )

    const now = new Date().toISOString()
    let createdAt = now
    // The form has no notes field: on edit, keep the stored notes (e.g.
    // from an imported backup) unless the caller explicitly sends new ones.
    let notes = input.notes
    if (existingId) {
      const existing = await db.transfers.get(existingId)
      invariant(existing, `No se encontró la transferencia a editar: ${existingId}`)
      createdAt = existing.createdAt
      notes ??= existing.notes
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
      ...(notes !== undefined && { notes }),
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
