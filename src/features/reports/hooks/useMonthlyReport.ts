import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getMonthlyReport } from '../service'

export function useMonthlyReport(month: MonthStamp) {
  return useLiveQuery(() => getMonthlyReport(month), [month])
}
