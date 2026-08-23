import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getMonthSummary } from '../service'

export function useMonthSummary(month: MonthStamp) {
  return useLiveQuery(() => getMonthSummary(month), [month])
}
