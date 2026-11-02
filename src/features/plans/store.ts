import { create } from 'zustand'

export type PlanKind = 'recurring' | 'installments'

/** UI-only state — plan *data* always comes from useLiveQuery. */
interface PlansUiState {
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

  // Editing a compra en cuotas only ever touches description/categoría
  // (see installmentPlans.repo.ts:updateInstallmentPlan) — small enough a
  // field set that it gets its own dialog instead of overloading the
  // create one.
  installmentEditId: string | null
  openInstallmentEditDialog: (id: string) => void
  closeInstallmentEditDialog: () => void

  /** Leaving a plans tab closes its dialogs: this store outlives the page,
   *  and a dialog left open would reappear on the next visit. */
  closeAll: () => void
}

export const usePlansUiStore = create<PlansUiState>((set) => ({
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

  closeAll: () =>
    set({ recurringDialogOpen: false, editingRecurringId: null, installmentDialogOpen: false, installmentEditId: null }),
}))
