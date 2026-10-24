import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getMonthFlowHistory } from '../service'

export function useMonthFlowHistory(monthsBack = 6, anchorMonth?: MonthStamp) {
  return useLiveQuery(() => getMonthFlowHistory(monthsBack, anchorMonth), [monthsBack, anchorMonth])
}
