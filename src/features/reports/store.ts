import { create } from 'zustand'
import { currentMonthStamp, type MonthStamp } from '@/lib/dates'

/** UI-only state: which month the category breakdown is scoped to. The net
 *  worth chart is always "last 6 months ending now", independent of this. */
interface ReportsUiState {
  month: MonthStamp
  setMonth: (month: MonthStamp) => void
}

export const useReportsUiStore = create<ReportsUiState>((set) => ({
  month: currentMonthStamp(),
  setMonth: (month) => set({ month }),
}))
