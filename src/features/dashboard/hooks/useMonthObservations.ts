import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getMonthObservations } from '../service'

export function useMonthObservations(month: MonthStamp) {
  return useLiveQuery(() => getMonthObservations(month), [month])
}
