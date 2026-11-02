import { create } from 'zustand'
import { currentMonthStamp, type MonthStamp } from '@/lib/dates'

/** UI-only state: which month the expense-side cards (Gastos del mes, Gasto
 *  por categoría, Evolución de gastos, Presupuestos a revisar) are scoped
 *  to. Patrimonio / Progreso de tus inversiones are deliberately
 *  NOT driven by this — those always show today's value, same convention
 *  as /patrimonio (ver docs/DECISIONS.md). */
interface DashboardUiState {
  month: MonthStamp
  setMonth: (month: MonthStamp) => void
  /** Whether "Más del mes" is unfolded — kept while moving around the app. */
  detailOpen: boolean
  setDetailOpen: (open: boolean) => void
}

export const useDashboardUiStore = create<DashboardUiState>((set) => ({
  month: currentMonthStamp(),
  setMonth: (month) => set({ month }),
  detailOpen: false,
  setDetailOpen: (detailOpen) => set({ detailOpen }),
}))
