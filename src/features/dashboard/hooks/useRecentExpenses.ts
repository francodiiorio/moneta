import { useLiveQuery } from 'dexie-react-hooks'
import { listTransactionsForMonth, type TransactionListItem } from '@/features/transactions/service'
import type { MonthStamp } from '@/lib/dates'

const RECENT_EXPENSES_LIMIT = 5

export function useRecentExpenses(month: MonthStamp): TransactionListItem[] | undefined {
  return useLiveQuery(async () => {
    const items = await listTransactionsForMonth(month)
    return items.slice(0, RECENT_EXPENSES_LIMIT)
  }, [month])
}
