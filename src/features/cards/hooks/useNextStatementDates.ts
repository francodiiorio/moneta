import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getNextStatementDates } from '../service'

/** `null` once the next statement has closed (or there's no card),
 *  `undefined` while loading. */
export function useNextStatementDates(cardId: string, period: MonthStamp | undefined) {
  const result = useLiveQuery(
    async () => ({ cardId, period, next: cardId && period ? await getNextStatementDates(cardId, period) : null }),
    [cardId, period],
  )
  // useLiveQuery keeps the previous result until the new query resolves:
  // the dialog would mount its form with another statement's dates.
  return result && result.cardId === cardId && result.period === period ? result.next : undefined
}
