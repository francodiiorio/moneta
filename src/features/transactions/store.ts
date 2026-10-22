import { create } from 'zustand'
import { currentMonthStamp, type MonthStamp } from '@/lib/dates'

/** UI-only state: selected month/filters and dialog state. Transaction
 *  *data* always comes from useLiveQuery — never cache it here. */
interface TransactionsUiState {
  month: MonthStamp
  categoryFilter: string | null
  accountFilter: string | null
  setMonth: (month: MonthStamp) => void
  setCategoryFilter: (categoryId: string | null) => void
  setAccountFilter: (accountId: string | null) => void

  dialogOpen: boolean
  editingTransactionId: string | null
  openCreateDialog: () => void
  openEditDialog: (transactionId: string) => void
  closeDialog: () => void
}

export const useTransactionsUiStore = create<TransactionsUiState>((set) => ({
  month: currentMonthStamp(),
  categoryFilter: null,
  accountFilter: null,
  setMonth: (month) => set({ month }),
  setCategoryFilter: (categoryId) => set({ categoryFilter: categoryId }),
  setAccountFilter: (accountId) => set({ accountFilter: accountId }),

  dialogOpen: false,
  editingTransactionId: null,
  openCreateDialog: () => set({ dialogOpen: true, editingTransactionId: null }),
  openEditDialog: (transactionId) => set({ dialogOpen: true, editingTransactionId: transactionId }),
  closeDialog: () => set({ dialogOpen: false, editingTransactionId: null }),
}))
