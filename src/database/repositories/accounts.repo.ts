import Dexie from 'dexie'
import { db } from '../db'
import type { Account, AccountAdjustment, Expense, Income, InvestmentLot, Transfer } from '@/domain/entities'
import { movementAccountProblem } from '@/domain/accounts'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { formatFullDate, type DateStamp } from '@/lib/dates'

export interface CreateAccountInput {
  name: string
  type: Account['type']
  currency: Account['currency']
  openingBalance: number
  openingDate: DateStamp
  notes?: string
}

/** Every field is sent on update (not a partial patch) — `notes` as
 *  `undefined` clears it. Same full-replace idea as `saveExpense`. */
export interface UpdateAccountInput {
  name: string
  type: Account['type']
  currency: Account['currency']
  openingBalance: number
  openingDate: DateStamp
  notes: string | undefined
}

export interface AccountMovementRecords {
  incomes: Income[]
  expenses: Expense[]
  adjustments: AccountAdjustment[]
  transfers: Transfer[]
  investmentLots: InvestmentLot[]
}

/** Every table a movement of an account lives in — the scope any write
 *  that must see "does this account have movements?" needs. */
function movementTables() {
  return [db.accounts, db.incomes, db.expenses, db.accountAdjustments, db.transfers, db.investmentLots] as const
}

export async function listAccounts(): Promise<Account[]> {
  return db.accounts.orderBy('order').toArray()
}

export async function getAccount(id: string): Promise<Account | undefined> {
  return db.accounts.get(id)
}

/** Raw records that move any account's balance — the caller turns them
 *  into balances with domain/accounts (`toAccountMovements` +
 *  `accountBalanceAt`). Expenses come off the `accountId` index, which
 *  Dexie leaves `undefined` out of, so credit-card/unspecified gastos are
 *  never even read. */
export async function listAccountMovementRecords(): Promise<AccountMovementRecords> {
  const [incomes, expenses, adjustments, transfers, investmentLots] = await Promise.all([
    db.incomes.toArray(),
    db.expenses.where('accountId').above(Dexie.minKey).toArray(),
    db.accountAdjustments.toArray(),
    db.transfers.toArray(),
    db.investmentLots.where('sourceAccountId').above(Dexie.minKey).toArray(),
  ])
  return { incomes, expenses, adjustments, transfers, investmentLots }
}

/** Earliest date of any movement of `accountId`, or `undefined` if it
 *  has none. Must run inside a transaction covering `movementTables()`. */
async function earliestMovementDate(accountId: string): Promise<DateStamp | undefined> {
  const [incomes, expenses, adjustments, transfersOut, transfersIn, lots] = await Promise.all([
    db.incomes.where('accountId').equals(accountId).toArray(),
    db.expenses.where('accountId').equals(accountId).toArray(),
    db.accountAdjustments.where('accountId').equals(accountId).toArray(),
    db.transfers.where('fromAccountId').equals(accountId).toArray(),
    db.transfers.where('toAccountId').equals(accountId).toArray(),
    db.investmentLots.where('sourceAccountId').equals(accountId).toArray(),
  ])
  const dates = [...incomes, ...expenses, ...adjustments, ...transfersOut, ...transfersIn, ...lots].map((m) => m.date)
  return dates.length === 0 ? undefined : dates.reduce((min, d) => (d < min ? d : min))
}

/**
 * Throws unless a movement dated `date` in `currency` can be recorded
 * against `accountId` — the account must exist, share the currency, and
 * have been opened by then (see domain/accounts:movementAccountProblem).
 * Every repository that writes a movement calls this inside its own `rw`
 * transaction, with `db.accounts` in scope, so the check and the write
 * can't interleave with an account edit.
 */
export async function assertAccountAccepts(
  accountId: string,
  movement: { date: DateStamp; currency: string },
): Promise<void> {
  const account = await db.accounts.get(accountId)
  invariant(account, `Cuenta no encontrada: ${accountId}`)
  const problem = movementAccountProblem(account, movement)
  invariant(problem === undefined, problem ?? '')
}

export async function createAccount(input: CreateAccountInput): Promise<Account> {
  invariant(Number.isInteger(input.openingBalance), `El saldo inicial debe ser un entero en unidades menores: ${input.openingBalance}`)
  const now = new Date().toISOString()
  return db.transaction('rw', db.accounts, async () => {
    const last = await db.accounts.orderBy('order').last()
    const account: Account = {
      id: generateId(),
      name: input.name,
      type: input.type,
      currency: input.currency,
      openingBalance: input.openingBalance,
      openingDate: input.openingDate,
      isArchived: false,
      order: (last?.order ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    await db.accounts.add(account)
    return account
  })
}

/**
 * Rejects the two edits that would silently rewrite history: changing the
 * currency of an account that already has movements (they'd all be in
 * the wrong currency), and moving `openingDate` past an existing
 * movement (it would fall before the account "existed" and stop counting).
 */
export async function updateAccount(id: string, input: UpdateAccountInput): Promise<void> {
  invariant(Number.isInteger(input.openingBalance), `El saldo inicial debe ser un entero en unidades menores: ${input.openingBalance}`)
  await db.transaction('rw', movementTables(), async () => {
    const existing = await db.accounts.get(id)
    invariant(existing, `Cuenta no encontrada: ${id}`)

    const earliest = await earliestMovementDate(id)
    if (earliest !== undefined) {
      invariant(
        input.currency === existing.currency,
        'No se puede cambiar la moneda de una cuenta que ya tiene movimientos',
      )
      invariant(
        input.openingDate <= earliest,
        `La fecha del saldo inicial no puede ser posterior al primer movimiento de la cuenta (${formatFullDate(earliest)})`,
      )
    }

    const account: Account = {
      id,
      name: input.name,
      type: input.type,
      currency: input.currency,
      openingBalance: input.openingBalance,
      openingDate: input.openingDate,
      isArchived: existing.isArchived,
      order: existing.order,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    await db.accounts.put(account)
  })
}

export async function setAccountArchived(id: string, isArchived: boolean): Promise<void> {
  await db.accounts.update(id, { isArchived, updatedAt: new Date().toISOString() })
}

/** Only an account with no movements at all can be deleted — one with
 *  history gets archived instead, so no income/gasto/ajuste is ever left
 *  pointing at an account that no longer exists. */
export async function deleteAccount(id: string): Promise<void> {
  await db.transaction('rw', movementTables(), async () => {
    const earliest = await earliestMovementDate(id)
    invariant(earliest === undefined, 'La cuenta tiene movimientos — archivala en vez de borrarla')
    await db.accounts.delete(id)
  })
}
