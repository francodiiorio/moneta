import { db } from '../db'
import { accountBalanceAt, adjustmentToReach, toAccountMovements } from '@/domain/accounts'
import type { AccountAdjustment } from '@/domain/entities'
import { isZero, money, type CurrencyCode, type Money } from '@/domain/money'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { formatFullDate, type DateStamp } from '@/lib/dates'
import { assertAccountAccepts, listAccountMovementRecords, movementTables } from './accounts.repo'

export interface CreateAdjustmentInput {
  accountId: string
  date: DateStamp
  /** Signed: positive raises the balance, negative lowers it. */
  amount: number
  currency: CurrencyCode
  description?: string
}

export async function listAdjustmentsInRange(startDate: string, endDate: string): Promise<AccountAdjustment[]> {
  return db.accountAdjustments.where('date').between(startDate, endDate, true, true).toArray()
}

export async function listAdjustmentsByAccount(accountId: string): Promise<AccountAdjustment[]> {
  const adjustments = await db.accountAdjustments.where('accountId').equals(accountId).toArray()
  adjustments.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  return adjustments
}

export async function createAdjustment(input: CreateAdjustmentInput): Promise<AccountAdjustment> {
  invariant(Number.isInteger(input.amount), `El ajuste debe ser un entero en unidades menores: ${input.amount}`)
  invariant(input.amount !== 0, 'Un ajuste no puede ser cero')

  return db.transaction('rw', [db.accountAdjustments, db.accounts], async () => {
    await assertAccountAccepts(input.accountId, input)
    const now = new Date().toISOString()
    const adjustment: AccountAdjustment = {
      id: generateId(),
      accountId: input.accountId,
      date: input.date,
      amount: input.amount,
      currency: input.currency,
      createdAt: now,
      updatedAt: now,
      ...(input.description !== undefined && { description: input.description }),
    }
    await db.accountAdjustments.add(adjustment)
    return adjustment
  })
}

export interface AdjustToReachInput {
  accountId: string
  date: DateStamp
  /** The balance the bank shows at the end of `date`, in minor units of
   *  the account's currency. */
  target: number
  description?: string
}

/**
 * "Ajustar saldo": stores whatever adjustment takes the computed balance
 * at `date` to `target`, or nothing if they already match. The account
 * and every movement are re-read and the difference computed inside the
 * same `rw` transaction as the write — computing it from a UI snapshot
 * would let a double submit (or another tab adding a movement in
 * between) store the same difference twice. Returns the stored
 * difference, or `undefined` when nothing needed adjusting.
 */
export async function createAdjustmentToReach(input: AdjustToReachInput): Promise<Money | undefined> {
  invariant(Number.isInteger(input.target), `El saldo debe ser un entero en unidades menores: ${input.target}`)

  return db.transaction('rw', movementTables(), async () => {
    const account = await db.accounts.get(input.accountId)
    invariant(account, `Cuenta no encontrada: ${input.accountId}`)
    const current = accountBalanceAt(account, toAccountMovements(await listAccountMovementRecords()), input.date)
    invariant(current, `La fecha es anterior al saldo inicial de "${account.name}" (${formatFullDate(account.openingDate)})`)

    const difference = adjustmentToReach(current, money(input.target, account.currency))
    if (isZero(difference)) return undefined

    await createAdjustment({
      accountId: account.id,
      date: input.date,
      amount: difference.amount,
      currency: account.currency,
      ...(input.description !== undefined && { description: input.description }),
    })
    return difference
  })
}

export async function deleteAdjustment(id: string): Promise<void> {
  await db.accountAdjustments.delete(id)
}
