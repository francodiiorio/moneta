import { create } from 'zustand'

/** UI-only state — card data always comes from useLiveQuery. */
interface CardsUiState {
  formOpen: boolean
  editingCardId: string | null
  showArchived: boolean
  openCreateDialog: () => void
  openEditDialog: (cardId: string) => void
  closeDialog: () => void
  toggleShowArchived: () => void
}

export const useCardsUiStore = create<CardsUiState>((set) => ({
  formOpen: false,
  editingCardId: null,
  showArchived: false,
  openCreateDialog: () => set({ formOpen: true, editingCardId: null }),
  openEditDialog: (cardId) => set({ formOpen: true, editingCardId: cardId }),
  closeDialog: () => set({ formOpen: false }),
  toggleShowArchived: () => set((s) => ({ showArchived: !s.showArchived })),
}))
