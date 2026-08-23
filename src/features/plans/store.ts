import { create } from 'zustand'

export type PlansTab = 'recurring' | 'installments'

/** UI-only state — plan *data* always comes from useLiveQuery. */
interface PlansUiState {
  tab: PlansTab
  setTab: (tab: PlansTab) => void

  recurringDialogOpen: boolean
  openRecurringDialog: () => void
  closeRecurringDialog: () => void

  installmentDialogOpen: boolean
  openInstallmentDialog: () => void
  closeInstallmentDialog: () => void
}

export const usePlansUiStore = create<PlansUiState>((set) => ({
  tab: 'recurring',
  setTab: (tab) => set({ tab }),

  recurringDialogOpen: false,
  openRecurringDialog: () => set({ recurringDialogOpen: true }),
  closeRecurringDialog: () => set({ recurringDialogOpen: false }),

  installmentDialogOpen: false,
  openInstallmentDialog: () => set({ installmentDialogOpen: true }),
  closeInstallmentDialog: () => set({ installmentDialogOpen: false }),
}))
