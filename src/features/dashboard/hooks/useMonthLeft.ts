import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getMonthLeft } from '../service'

export function useMonthLeft(month: MonthStamp) {
  return useLiveQuery(() => getMonthLeft(month), [month])
}
