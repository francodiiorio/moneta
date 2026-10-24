import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getIncomeByCategory } from '../service'

export function useIncomeByCategory(month: MonthStamp) {
  return useLiveQuery(() => getIncomeByCategory(month), [month])
}
