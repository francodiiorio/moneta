import { create } from 'zustand'
import { currentMonthStamp, type MonthStamp } from '@/lib/dates'

/** UI-only state — budget *data* always comes from useLiveQuery. `month`
 *  only affects how monthly budgets are evaluated; yearly ones always
 *  show the current calendar year regardless. */
interface BudgetsUiState {
  month: MonthStamp
  setMonth: (month: MonthStamp) => void

  dialogOpen: boolean
  openCreateDialog: () => void
  closeDialog: () => void
}

export const useBudgetsUiStore = create<BudgetsUiState>((set) => ({
  month: currentMonthStamp(),
  setMonth: (month) => set({ month }),

  dialogOpen: false,
  openCreateDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}))
