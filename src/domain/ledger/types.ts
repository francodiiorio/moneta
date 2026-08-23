import type { CurrencyCode, Minor } from '@/domain/money'
import type { Transaction } from '@/domain/entities'
import type { DateStamp } from '@/lib/dates'

export interface PostingDraft {
  target: 'account' | 'category'
  accountId?: string
  categoryId?: string
  amount: Minor
  currency: CurrencyCode
}

/** Everything needed to persist a transaction + its postings, minus the
 *  ids and timestamps the repository assigns on insert. */
export interface LedgerEntryDraft {
  date: DateStamp
  kind: Transaction['kind']
  description: string
  notes?: string
  tags?: string[]
  status: Transaction['status']
  fx?: Transaction['fx']
  sourcePlanId?: string
  occurrenceIndex?: number
  postings: PostingDraft[]
}
