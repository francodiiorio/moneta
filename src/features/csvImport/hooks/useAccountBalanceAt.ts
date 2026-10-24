import { useLiveQuery } from 'dexie-react-hooks'
import type { DateStamp } from '@/lib/dates'
import { getAccountBalanceAt } from '../service'

/** `null` before the account's opening date, `undefined` while loading or
 *  without a date. */
export function useAccountBalanceAt(accountId: string, date: DateStamp) {
  return useLiveQuery(
    async () => (date ? ((await getAccountBalanceAt(accountId, date)) ?? null) : undefined),
    [accountId, date],
  )
}
