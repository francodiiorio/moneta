import { minor, type CurrencyCode } from '@/domain/money'
import { validateLedgerEntry, type PostingDraft } from '@/domain/ledger'
import type { BackupDataV1 } from './schemas/v1'

/** Re-validates every transaction's postings using the same domain
 *  invariants applied on normal writes — a backup file is untrusted
 *  input and must prove itself before it replaces the live database. */
export function validateLedgerIntegrity(data: BackupDataV1): void {
  const accountCurrencies = new Map<string, CurrencyCode>(
    data.accounts.map((a) => [a.id, a.currency]),
  )

  const postingsByTransaction = new Map<string, PostingDraft[]>()
  for (const posting of data.postings) {
    const draft: PostingDraft = {
      target: posting.target,
      amount: minor(posting.amount),
      currency: posting.currency,
      ...(posting.accountId !== undefined && { accountId: posting.accountId }),
      ...(posting.categoryId !== undefined && { categoryId: posting.categoryId }),
    }
    const list = postingsByTransaction.get(posting.transactionId) ?? []
    list.push(draft)
    postingsByTransaction.set(posting.transactionId, list)
  }

  for (const transaction of data.transactions) {
    const postings = postingsByTransaction.get(transaction.id) ?? []
    try {
      validateLedgerEntry(
        {
          date: transaction.date,
          kind: transaction.kind,
          description: transaction.description,
          status: transaction.status,
          ...(transaction.fx !== undefined && { fx: transaction.fx }),
          postings,
        },
        accountCurrencies,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Transacción inválida "${transaction.description}" (${transaction.id}): ${message}`,
      )
    }
  }
}
