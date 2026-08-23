import { create } from 'zustand'

export type NetWorthTab = 'summary' | 'savings'

/** UI-only state — net worth *data* always comes from useLiveQuery. */
interface NetWorthUiState {
  tab: NetWorthTab
  setTab: (tab: NetWorthTab) => void

  savingsDialogOpen: boolean
  editingSavingsId: string | null
  openCreateSavingsDialog: () => void
  openEditSavingsDialog: (id: string) => void
  closeSavingsDialog: () => void
}

export const useNetWorthUiStore = create<NetWorthUiState>((set) => ({
  tab: 'summary',
  setTab: (tab) => set({ tab }),

  savingsDialogOpen: false,
  editingSavingsId: null,
  openCreateSavingsDialog: () => set({ savingsDialogOpen: true, editingSavingsId: null }),
  openEditSavingsDialog: (id) => set({ savingsDialogOpen: true, editingSavingsId: id }),
  closeSavingsDialog: () => set({ savingsDialogOpen: false, editingSavingsId: null }),
}))
