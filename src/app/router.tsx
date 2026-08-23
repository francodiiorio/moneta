import { createBrowserRouter } from 'react-router'
import { AppLayout } from './layout/AppLayout'
import { RootFallback } from './RootFallback'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppLayout,
    // Route Components load lazily below; a direct load/refresh on a deep
    // URL (e.g. /ajustes/categorias) needs that leaf's chunk resolved
    // before the router can render anything at all, even AppLayout's
    // static nav shell — see RootFallback.tsx.
    HydrateFallback: RootFallback,
    children: [
      {
        index: true,
        lazy: async () => {
          const { DashboardPage } = await import('@/features/dashboard/routes/DashboardPage')
          return { Component: DashboardPage }
        },
      },
      {
        path: 'cuentas',
        lazy: async () => {
          const { AccountsPage } = await import('@/features/accounts/routes/AccountsPage')
          return { Component: AccountsPage }
        },
      },
      {
        path: 'movimientos',
        lazy: async () => {
          const { TransactionsPage } = await import('@/features/transactions/routes/TransactionsPage')
          return { Component: TransactionsPage }
        },
      },
      {
        path: 'presupuestos',
        lazy: async () => {
          const { BudgetsPage } = await import('@/features/budgets/routes/BudgetsPage')
          return { Component: BudgetsPage }
        },
      },
      {
        path: 'planes',
        lazy: async () => {
          const { PlansPage } = await import('@/features/plans/routes/PlansPage')
          return { Component: PlansPage }
        },
      },
      {
        path: 'reportes',
        lazy: async () => {
          const { ReportsPage } = await import('@/features/reports/routes/ReportsPage')
          return { Component: ReportsPage }
        },
      },
      {
        path: 'ajustes',
        lazy: async () => {
          const { SettingsPage } = await import('@/features/settings/routes/SettingsPage')
          return { Component: SettingsPage }
        },
      },
      {
        path: 'ajustes/categorias',
        lazy: async () => {
          const { CategoriesPage } = await import('@/features/categories/routes/CategoriesPage')
          return { Component: CategoriesPage }
        },
      },
      {
        path: 'ajustes/tasas',
        lazy: async () => {
          const { ExchangeRatesPage } = await import('@/features/exchangeRates/routes/ExchangeRatesPage')
          return { Component: ExchangeRatesPage }
        },
      },
    ],
  },
])
