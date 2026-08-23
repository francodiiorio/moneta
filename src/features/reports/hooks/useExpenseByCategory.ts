import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getExpenseByCategory } from '../service'

export function useExpenseByCategory(month: MonthStamp) {
  return useLiveQuery(() => getExpenseByCategory(month), [month])
}
