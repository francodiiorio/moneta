import { useLiveQuery } from 'dexie-react-hooks'
import { listTransactionsForMonth } from '../service'
import { useTransactionsUiStore } from '../store'

export function useTransactions() {
  const month = useTransactionsUiStore((s) => s.month)
  const accountFilter = useTransactionsUiStore((s) => s.accountFilter)
  const categoryFilter = useTransactionsUiStore((s) => s.categoryFilter)

  return useLiveQuery(
    () =>
      listTransactionsForMonth(month, {
        ...(accountFilter && { accountId: accountFilter }),
        ...(categoryFilter && { categoryId: categoryFilter }),
      }),
    [month, accountFilter, categoryFilter],
  )
}
