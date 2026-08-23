import { db } from '../db'
import type { Posting, Transaction } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { validateLedgerEntry, type LedgerEntryDraft } from '@/domain/ledger'
import type { CurrencyCode } from '@/domain/money'

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
 * Validates and persists a ledger entry. When `existingId` is given, the
 * transaction's old postings are replaced wholesale by the new ones
 * (rather than diffed) — simpler and still atomic; see docs/DATA_MODEL.md.
 */
export async function saveTransaction(entry: LedgerEntryDraft, existingId?: string): Promise<string> {
  const now = new Date().toISOString()
  const id = existingId ?? generateId()

  await db.transaction('rw', db.transactions, db.postings, db.accounts, async () => {
    // Re-read currencies and re-validate inside the transaction, not before
    // it opens — an account's currency (or the transaction being edited)
    // could otherwise change between the check and the write.
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
  })

  return id
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transaction('rw', db.transactions, db.postings, async () => {
    await db.postings.where('transactionId').equals(id).delete()
    await db.transactions.delete(id)
  })
}
