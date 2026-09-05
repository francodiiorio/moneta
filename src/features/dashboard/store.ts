import { create } from 'zustand'
import { currentMonthStamp, type MonthStamp } from '@/lib/dates'

/** UI-only state: which month the expense-side cards (Gastos del mes, Gasto
 *  por categoría, Evolución de gastos, Presupuestos a revisar) are scoped
 *  to. Ahorro e inversiones / Progreso de tus inversiones are deliberately
 *  NOT driven by this — those always show today's value, same convention
 *  as /patrimonio (ver docs/DECISIONS.md). */
interface DashboardUiState {
  month: MonthStamp
  setMonth: (month: MonthStamp) => void
}

export const useDashboardUiStore = create<DashboardUiState>((set) => ({
  month: currentMonthStamp(),
  setMonth: (month) => set({ month }),
}))
