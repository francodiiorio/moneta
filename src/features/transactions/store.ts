import { create } from 'zustand'
import { currentMonthStamp, type MonthStamp } from '@/lib/dates'

export type TransactionKindTab = 'expense' | 'income' | 'transfer'

/** UI-only state: selected month/filters and dialog state. Transaction
 *  *data* always comes from useLiveQuery — never cache it here. */
interface TransactionsUiState {
  month: MonthStamp
  accountFilter: string | null
  categoryFilter: string | null
  setMonth: (month: MonthStamp) => void
  setAccountFilter: (accountId: string | null) => void
  setCategoryFilter: (categoryId: string | null) => void

  dialogOpen: boolean
  dialogKind: TransactionKindTab
  editingTransactionId: string | null
  openCreateDialog: (kind?: TransactionKindTab) => void
  openEditDialog: (transactionId: string, kind: TransactionKindTab) => void
  closeDialog: () => void
}

export const useTransactionsUiStore = create<TransactionsUiState>((set) => ({
  month: currentMonthStamp(),
  accountFilter: null,
  categoryFilter: null,
  setMonth: (month) => set({ month }),
  setAccountFilter: (accountId) => set({ accountFilter: accountId }),
  setCategoryFilter: (categoryId) => set({ categoryFilter: categoryId }),

  dialogOpen: false,
  dialogKind: 'expense',
  editingTransactionId: null,
  openCreateDialog: (kind = 'expense') =>
    set({ dialogOpen: true, dialogKind: kind, editingTransactionId: null }),
  openEditDialog: (transactionId, kind) =>
    set({ dialogOpen: true, dialogKind: kind, editingTransactionId: transactionId }),
  closeDialog: () => set({ dialogOpen: false, editingTransactionId: null }),
}))
