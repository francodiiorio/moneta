import { create } from 'zustand'

/** UI-only state: which dialog is open, and for which account. Account
 *  *data* always comes from useLiveQuery — never cache it here. */
interface AccountsUiState {
  formOpen: boolean
  editingAccountId: string | null
  adjustingAccountId: string | null
  showArchived: boolean
  openCreateDialog: () => void
  openEditDialog: (accountId: string) => void
  openAdjustDialog: (accountId: string) => void
  closeDialogs: () => void
  toggleShowArchived: () => void
}

export const useAccountsUiStore = create<AccountsUiState>((set) => ({
  formOpen: false,
  editingAccountId: null,
  adjustingAccountId: null,
  showArchived: false,
  openCreateDialog: () => set({ formOpen: true, editingAccountId: null, adjustingAccountId: null }),
  openEditDialog: (accountId) => set({ formOpen: true, editingAccountId: accountId, adjustingAccountId: null }),
  openAdjustDialog: (accountId) => set({ formOpen: false, editingAccountId: null, adjustingAccountId: accountId }),
  closeDialogs: () => set({ formOpen: false, editingAccountId: null, adjustingAccountId: null }),
  toggleShowArchived: () => set((s) => ({ showArchived: !s.showArchived })),
}))
