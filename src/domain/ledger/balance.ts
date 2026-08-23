import { minor, type Minor } from '@/domain/money'

/**
 * A pure sum — the caller (repository) is responsible for fetching only
 * the confirmed postings for the right account before calling this, so
 * the domain layer stays free of IndexedDB queries.
 */
export function calculateAccountBalance(
  openingBalance: Minor,
  confirmedPostingAmounts: readonly Minor[],
): Minor {
  const total = confirmedPostingAmounts.reduce<number>(
    (sum, amount) => sum + amount,
    openingBalance,
  )
  return minor(total)
}
