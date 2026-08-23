import { create } from 'zustand'

/** UI-only state: which dialog is open, and for which account. Account
 *  *data* always comes from useLiveQuery — never cache it here. */
interface AccountsUiState {
  dialogOpen: boolean
  editingAccountId: string | null
  openCreateDialog: () => void
  openEditDialog: (accountId: string) => void
  closeDialog: () => void
}

export const useAccountsUiStore = create<AccountsUiState>((set) => ({
  dialogOpen: false,
  editingAccountId: null,
  openCreateDialog: () => set({ dialogOpen: true, editingAccountId: null }),
  openEditDialog: (accountId) => set({ dialogOpen: true, editingAccountId: accountId }),
  closeDialog: () => set({ dialogOpen: false, editingAccountId: null }),
}))
