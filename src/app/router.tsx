import { createBrowserRouter, Navigate } from 'react-router'
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
        path: 'movimientos',
        lazy: async () => {
          const { TransactionsPage } = await import('@/features/transactions/routes/TransactionsPage')
          return { Component: TransactionsPage }
        },
      },
      {
        path: 'movimientos/importar',
        lazy: async () => {
          const { ImportCsvPage } = await import('@/features/csvImport/routes/ImportCsvPage')
          return { Component: ImportCsvPage }
        },
      },
      {
        // Cuentas is a tab of Tarjetas y cuentas (Etapa 9) — old links still land on it.
        path: 'cuentas',
        Component: () => <Navigate to="/tarjetas?tab=cuentas" replace />,
      },
      {
        path: 'tarjetas',
        lazy: async () => {
          const { MoneyHubPage } = await import('./hubs/MoneyHubPage')
          return { Component: MoneyHubPage }
        },
      },
      {
        path: 'tarjetas/:cardId',
        lazy: async () => {
          const { CardStatementPage } = await import('@/features/cards/routes/CardStatementPage')
          return { Component: CardStatementPage }
        },
      },
      {
        path: 'presupuestos',
        lazy: async () => {
          const { BudgetHubPage } = await import('./hubs/BudgetHubPage')
          return { Component: BudgetHubPage }
        },
      },
      {
        // Planes was split (Etapa 9): recurring plans are Presupuesto →
        // Gastos fijos, installments Tarjetas y cuentas → Cuotas.
        path: 'planes',
        Component: () => <Navigate to="/presupuestos?tab=fijos" replace />,
      },
      {
        path: 'patrimonio',
        lazy: async () => {
          const { NetWorthPage } = await import('@/features/networth/routes/NetWorthPage')
          return { Component: NetWorthPage }
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
        path: 'ayuda',
        lazy: async () => {
          const { HelpPage } = await import('@/features/help/routes/HelpPage')
          return { Component: HelpPage }
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
        // Absorbed into Patrimonio → Cotizaciones (Etapa 6C) —
        // old bookmarks/links to this URL still land somewhere useful.
        path: 'ajustes/tasas',
        Component: () => <Navigate to="/patrimonio" replace />,
      },
    ],
  },
  {
    // Deliberately outside AppLayout: the printable monthly report must
    // render with zero app chrome (sidebar, bottom nav, safe-area
    // padding) — see docs/DECISIONS.md "Informe mensual".
    path: '/reportes/informe/:month',
    HydrateFallback: RootFallback,
    lazy: async () => {
      const { MonthlyReportPage } = await import('@/features/reports/routes/MonthlyReportPage')
      return { Component: MonthlyReportPage }
    },
  },
])
