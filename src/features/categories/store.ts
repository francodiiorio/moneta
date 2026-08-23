import { create } from 'zustand'
import type { Category } from '@/domain/entities'

/** UI-only state — category *data* always comes from useLiveQuery. */
interface CategoriesUiState {
  tab: Category['kind']
  setTab: (tab: Category['kind']) => void

  showArchived: boolean
  toggleShowArchived: () => void

  dialogOpen: boolean
  editingCategoryId: string | null
  openCreateDialog: () => void
  openEditDialog: (categoryId: string) => void
  closeDialog: () => void
}

export const useCategoriesUiStore = create<CategoriesUiState>((set) => ({
  tab: 'expense',
  setTab: (tab) => set({ tab }),

  showArchived: false,
  toggleShowArchived: () => set((s) => ({ showArchived: !s.showArchived })),

  dialogOpen: false,
  editingCategoryId: null,
  openCreateDialog: () => set({ dialogOpen: true, editingCategoryId: null }),
  openEditDialog: (categoryId) => set({ dialogOpen: true, editingCategoryId: categoryId }),
  closeDialog: () => set({ dialogOpen: false, editingCategoryId: null }),
}))
