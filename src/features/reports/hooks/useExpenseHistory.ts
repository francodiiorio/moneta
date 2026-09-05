import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getExpenseHistory } from '../service'

export function useExpenseHistory(monthsBack = 6, anchorMonth?: MonthStamp) {
  return useLiveQuery(() => getExpenseHistory(monthsBack, anchorMonth), [monthsBack, anchorMonth])
}
