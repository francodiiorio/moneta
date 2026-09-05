import { useLiveQuery } from 'dexie-react-hooks'
import { listTransactionsForMonth } from '../service'
import { useTransactionsUiStore } from '../store'

export function useTransactions() {
  const month = useTransactionsUiStore((s) => s.month)
  const categoryFilter = useTransactionsUiStore((s) => s.categoryFilter)

  return useLiveQuery(
    () => listTransactionsForMonth(month, { ...(categoryFilter && { categoryId: categoryFilter }) }),
    [month, categoryFilter],
  )
}
