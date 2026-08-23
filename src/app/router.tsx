import { createBrowserRouter } from 'react-router'
import { AppLayout } from './layout/AppLayout'
import { DashboardPage } from '@/features/dashboard/routes/DashboardPage'
import { AccountsPage } from '@/features/accounts/routes/AccountsPage'
import { TransactionsPage } from '@/features/transactions/routes/TransactionsPage'
import { BudgetsPage } from '@/features/budgets/routes/BudgetsPage'
import { ReportsPage } from '@/features/reports/routes/ReportsPage'
import { SettingsPage } from '@/features/settings/routes/SettingsPage'
import { CategoriesPage } from '@/features/categories/routes/CategoriesPage'
import { ExchangeRatesPage } from '@/features/exchangeRates/routes/ExchangeRatesPage'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, Component: DashboardPage },
      { path: 'cuentas', Component: AccountsPage },
      { path: 'movimientos', Component: TransactionsPage },
      { path: 'presupuestos', Component: BudgetsPage },
      { path: 'reportes', Component: ReportsPage },
      { path: 'ajustes', Component: SettingsPage },
      { path: 'ajustes/categorias', Component: CategoriesPage },
      { path: 'ajustes/tasas', Component: ExchangeRatesPage },
    ],
  },
])
