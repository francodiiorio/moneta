import { useLiveQuery } from 'dexie-react-hooks'
import { listTransactionsForMonth } from '../service'
import { useTransactionsUiStore } from '../store'

export function useTransactions() {
  const month = useTransactionsUiStore((s) => s.month)
  const categoryFilter = useTransactionsUiStore((s) => s.categoryFilter)
  const accountFilter = useTransactionsUiStore((s) => s.accountFilter)

  return useLiveQuery(
    () =>
      listTransactionsForMonth(month, {
        ...(categoryFilter && { categoryId: categoryFilter }),
        ...(accountFilter && { accountId: accountFilter }),
      }),
    [month, categoryFilter, accountFilter],
  )
}
