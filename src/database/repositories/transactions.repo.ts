import Dexie from 'dexie'
import { db } from '../db'
import type { Posting, Transaction } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { validateLedgerEntry, type LedgerEntryDraft } from '@/domain/ledger'
import type { CurrencyCode } from '@/domain/money'
import type { DateStamp } from '@/lib/dates'

export interface TransactionWithPostings {
  transaction: Transaction
  postings: Posting[]
}

async function accountCurrencyMap(): Promise<Map<string, CurrencyCode>> {
  const accounts = await db.accounts.toArray()
  return new Map(accounts.map((a) => [a.id, a.currency]))
}

export async function listTransactionsInRange(
  startDate: string,
  endDate: string,
): Promise<TransactionWithPostings[]> {
  const transactions = await db.transactions.where('date').between(startDate, endDate, true, true).toArray()
  transactions.sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  )

  const ids = transactions.map((t) => t.id)
  const allPostings = ids.length > 0 ? await db.postings.where('transactionId').anyOf(ids).toArray() : []
  const postingsByTransaction = new Map<string, Posting[]>()
  for (const posting of allPostings) {
    const list = postingsByTransaction.get(posting.transactionId) ?? []
    list.push(posting)
    postingsByTransaction.set(posting.transactionId, list)
  }

  return transactions.map((transaction) => ({
    transaction,
    postings: postingsByTransaction.get(transaction.id) ?? [],
  }))
}

/**
 * Validates and persists a ledger entry. Assumes it's already running
 * inside an open Dexie `rw` transaction covering at least `transactions`,
 * `postings` and `accounts` — callers that need to write more than one
 * entry atomically (e.g. installmentPlans.repo.ts writing a plan + its N
 * occurrences) open that transaction themselves and call this directly,
 * rather than relying on Dexie's implicit nested-transaction joining.
 * `saveTransaction` below is the single-entry wrapper for everyone else.
 */
export async function writeLedgerEntry(entry: LedgerEntryDraft, existingId?: string): Promise<string> {
  const now = new Date().toISOString()
  const id = existingId ?? generateId()

  // Re-read currencies and re-validate here, not before the transaction
  // opens — an account's currency (or the transaction being edited) could
  // otherwise change between the check and the write.
  const currencies = await accountCurrencyMap()
  validateLedgerEntry(entry, currencies)

  let createdAt = now
  if (existingId) {
    const existing = await db.transactions.get(existingId)
    invariant(existing, `No se encontró el movimiento a editar: ${existingId}`)
    createdAt = existing.createdAt
    await db.postings.where('transactionId').equals(existingId).delete()
  }

  const transaction: Transaction = {
    id,
    date: entry.date,
    kind: entry.kind,
    description: entry.description,
    status: entry.status,
    createdAt,
    updatedAt: now,
    ...(entry.notes !== undefined && { notes: entry.notes }),
    ...(entry.tags !== undefined && { tags: entry.tags }),
    ...(entry.fx !== undefined && { fx: entry.fx }),
    ...(entry.sourcePlanId !== undefined && { sourcePlanId: entry.sourcePlanId }),
    ...(entry.occurrenceIndex !== undefined && { occurrenceIndex: entry.occurrenceIndex }),
  }
  await db.transactions.put(transaction)

  const postings: Posting[] = entry.postings.map((posting) => ({
    id: generateId(),
    transactionId: id,
    target: posting.target,
    amount: posting.amount,
    currency: posting.currency,
    date: entry.date,
    ...(posting.accountId !== undefined && { accountId: posting.accountId }),
    ...(posting.categoryId !== undefined && { categoryId: posting.categoryId }),
  }))
  await db.postings.bulkAdd(postings)

  return id
}

/**
 * Validates and persists a ledger entry. When `existingId` is given, the
 * transaction's old postings are replaced wholesale by the new ones
 * (rather than diffed) — simpler and still atomic; see docs/DATA_MODEL.md.
 */
export async function saveTransaction(entry: LedgerEntryDraft, existingId?: string): Promise<string> {
  return db.transaction('rw', db.transactions, db.postings, db.accounts, () =>
    writeLedgerEntry(entry, existingId),
  )
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transaction('rw', db.transactions, db.postings, async () => {
    await db.postings.where('transactionId').equals(id).delete()
    await db.transactions.delete(id)
  })
}

/** Every transaction materialized from a plan (i.e. `sourcePlanId` set) —
 *  Dexie excludes `undefined` keys from an index, so this is a direct
 *  index scan, not a full-table one. Used to compute installment plan
 *  progress. */
export async function listPlanTransactions(): Promise<Transaction[]> {
  return db.transactions.where('sourcePlanId').above(Dexie.minKey).toArray()
}

/**
 * Deletes only the still-`projected` transactions (and their postings)
 * for a plan — `confirmed` ones already happened and are left untouched.
 * Same "already inside a transaction" convention as `writeLedgerEntry`;
 * used by installmentPlans.repo.ts's `deleteInstallmentPlan`.
 */
export async function deleteProjectedBySourcePlanId(sourcePlanId: string): Promise<void> {
  const projectedIds = await db.transactions
    .where('sourcePlanId')
    .equals(sourcePlanId)
    .filter((t) => t.status === 'projected')
    .primaryKeys()
  if (projectedIds.length === 0) return
  await db.postings.where('transactionId').anyOf(projectedIds).delete()
  await db.transactions.bulkDelete(projectedIds)
}

/**
 * Promotes every `projected` transaction whose date has arrived (`<=
 * today`) to `confirmed` — from that point on it counts toward account
 * balances and reports (both already filter by `status === 'confirmed'`).
 * Idempotent: nothing is left in `projected` state for a date once this
 * has run for it, so re-running finds nothing more to promote.
 */
export async function confirmDueProjected(today: DateStamp): Promise<number> {
  return db.transactions
    .where('[status+date]')
    .between(['projected', Dexie.minKey], ['projected', today], true, true)
    .modify({ status: 'confirmed' })
}
