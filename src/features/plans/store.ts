import { create } from 'zustand'

export type PlansTab = 'recurring' | 'installments'

/** UI-only state — plan *data* always comes from useLiveQuery. */
interface PlansUiState {
  tab: PlansTab
  setTab: (tab: PlansTab) => void

  // One dialog, two modes — same pattern as networth's Savings dialog:
  // `editingRecurringId === null` means "creating a new one".
  recurringDialogOpen: boolean
  editingRecurringId: string | null
  openCreateRecurringDialog: () => void
  openEditRecurringDialog: (id: string) => void
  closeRecurringDialog: () => void

  installmentDialogOpen: boolean
  openInstallmentDialog: () => void
  closeInstallmentDialog: () => void

  // Editing a compra en cuotas only ever touches description/cuenta/
  // categoría (see installmentPlans.repo.ts:updateInstallmentPlan) — small
  // enough a field set that it gets its own dialog instead of overloading
  // the create one.
  installmentEditId: string | null
  openInstallmentEditDialog: (id: string) => void
  closeInstallmentEditDialog: () => void
}

export const usePlansUiStore = create<PlansUiState>((set) => ({
  tab: 'recurring',
  setTab: (tab) => set({ tab }),

  recurringDialogOpen: false,
  editingRecurringId: null,
  openCreateRecurringDialog: () => set({ recurringDialogOpen: true, editingRecurringId: null }),
  openEditRecurringDialog: (id) => set({ recurringDialogOpen: true, editingRecurringId: id }),
  closeRecurringDialog: () => set({ recurringDialogOpen: false, editingRecurringId: null }),

  installmentDialogOpen: false,
  openInstallmentDialog: () => set({ installmentDialogOpen: true }),
  closeInstallmentDialog: () => set({ installmentDialogOpen: false }),

  installmentEditId: null,
  openInstallmentEditDialog: (id) => set({ installmentEditId: id }),
  closeInstallmentEditDialog: () => set({ installmentEditId: null }),
}))
