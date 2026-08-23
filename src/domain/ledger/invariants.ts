import { invariant } from '@/lib/invariant'
import { roundHalfUp, type CurrencyCode } from '@/domain/money'
import type { LedgerEntryDraft } from './types'

/**
 * Validates the shape and arithmetic of a ledger entry before it's
 * persisted. `accountCurrencies` maps every account posting's
 * `accountId` to that account's fixed currency, so a posting can't be
 * silently recorded in the wrong currency.
 */
export function validateLedgerEntry(
  entry: LedgerEntryDraft,
  accountCurrencies: ReadonlyMap<string, CurrencyCode>,
): void {
  invariant(entry.postings.length >= 2, 'A transaction must have at least 2 postings')

  for (const posting of entry.postings) {
    if (posting.target === 'account') {
      invariant(
        !!posting.accountId && !posting.categoryId,
        'Account postings must set accountId and not categoryId',
      )
      const accountCurrency = accountCurrencies.get(posting.accountId)
      invariant(accountCurrency !== undefined, `Unknown account: ${posting.accountId}`)
      invariant(
        posting.currency === accountCurrency,
        `Posting currency ${posting.currency} doesn't match account currency ${accountCurrency}`,
      )
    } else {
      invariant(
        !!posting.categoryId && !posting.accountId,
        'Category postings must set categoryId and not accountId',
      )
    }
  }

  if (entry.fx) {
    const { rate, to } = entry.fx
    const total = entry.postings.reduce((sum, posting) => {
      const converted =
        posting.currency === to ? posting.amount : roundHalfUp(posting.amount * rate)
      return sum + converted
    }, 0)
    invariant(
      Math.abs(total) <= 1,
      `Cross-currency transaction postings don't balance in ${to} (off by ${total})`,
    )
  } else {
    const currencies = new Set(entry.postings.map((p) => p.currency))
    invariant(
      currencies.size === 1,
      `A mono-currency transaction can't mix currencies: ${[...currencies].join(', ')}`,
    )
    const total = entry.postings.reduce((sum, p) => sum + p.amount, 0)
    invariant(total === 0, `Transaction postings must sum to zero, got ${total}`)
  }
}
