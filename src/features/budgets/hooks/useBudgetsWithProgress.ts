import { useLiveQuery } from 'dexie-react-hooks'
import type { MonthStamp } from '@/lib/dates'
import { getBudgetsWithProgress } from '../service'

export function useBudgetsWithProgress(month: MonthStamp) {
  return useLiveQuery(() => getBudgetsWithProgress(month), [month])
}
