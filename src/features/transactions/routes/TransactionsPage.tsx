import { ArrowLeftRight } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'

export function TransactionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Movimientos" description="Ingresos, gastos y transferencias." />
      <EmptyState
        icon={ArrowLeftRight}
        title="Próximamente"
        description="La carga de movimientos se implementa en la siguiente etapa."
      />
    </div>
  )
}
