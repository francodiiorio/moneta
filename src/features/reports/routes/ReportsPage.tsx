import { BarChart3 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'

export function ReportsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reportes"
        description="Gasto por categoría y evolución de tu patrimonio."
      />
      <EmptyState
        icon={BarChart3}
        title="Próximamente"
        description="Los reportes se implementan en una etapa futura."
      />
    </div>
  )
}
