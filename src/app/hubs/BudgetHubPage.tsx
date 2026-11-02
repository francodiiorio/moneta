import { BudgetsPage } from '@/features/budgets/routes/BudgetsPage'
import { PlansPage } from '@/features/plans/routes/PlansPage'
import { HubPage } from './HubPage'

export function BudgetHubPage() {
  return (
    <HubPage
      title="Presupuesto"
      tabs={[
        { value: 'presupuestos', label: 'Presupuestos', content: <BudgetsPage embedded /> },
        { value: 'fijos', label: 'Gastos fijos', content: <PlansPage kind="recurring" /> },
      ]}
    />
  )
}
