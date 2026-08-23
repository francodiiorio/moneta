import { LayoutDashboard } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description="Resumen del mes y evolución de tu patrimonio." />
      <EmptyState
        icon={LayoutDashboard}
        title="Todavía no hay datos"
        description="Cargá tus cuentas y movimientos para ver el resumen acá."
      />
    </div>
  )
}
