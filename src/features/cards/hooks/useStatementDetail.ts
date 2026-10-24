import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getStatementDetail } from '../service'

/** `null` while the card doesn't exist (bad URL), `undefined` while loading. */
export function useStatementDetail(cardId: string, period: MonthStamp | undefined) {
  return useLiveQuery(
    async () => (period === undefined ? undefined : ((await getStatementDetail(cardId, period)) ?? null)),
    [cardId, period],
  )
}
