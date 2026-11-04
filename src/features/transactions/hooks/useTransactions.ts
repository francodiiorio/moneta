import { useLiveQuery } from 'dexie-react-hooks'
import { getMonthSpending, listTransactionsForMonth, type TransactionFilters } from '../service'
import { useTransactionsUiStore } from '../store'

function useFilters(): TransactionFilters {
  const categoryFilter = useTransactionsUiStore((s) => s.categoryFilter)
  const hideCuotas = useTransactionsUiStore((s) => s.hideCuotas)
  return { ...(categoryFilter && { categoryId: categoryFilter }), ...(hideCuotas && { hideCuotas }) }
}

export function useTransactions() {
  const month = useTransactionsUiStore((s) => s.month)
  const filters = useFilters()
  return useLiveQuery(() => listTransactionsForMonth(month, filters), [month, filters.categoryId, filters.hideCuotas])
}

/** The total of the gastos the list shows, with the same filters. */
export function useMonthSpending() {
  const month = useTransactionsUiStore((s) => s.month)
  const filters = useFilters()
  return useLiveQuery(() => getMonthSpending(month, filters), [month, filters.categoryId, filters.hideCuotas])
}
