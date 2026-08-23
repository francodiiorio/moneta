import { PiggyBank } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'

export function BudgetsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Presupuestos" description="Seguimiento mensual y anual por categoría." />
      <EmptyState
        icon={PiggyBank}
        title="Próximamente"
        description="Los presupuestos se implementan en una etapa futura."
      />
    </div>
  )
}
