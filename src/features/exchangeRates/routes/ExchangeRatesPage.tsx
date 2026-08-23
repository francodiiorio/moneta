import { Link } from 'react-router'
import { toast } from 'sonner'
import { ChevronLeft, Trash2, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { useExchangeRates } from '../hooks/useExchangeRates'
import { deleteExchangeRate } from '../service'
import { ExchangeRateForm } from '../components/ExchangeRateForm'

async function handleDelete(id: string) {
  try {
    await deleteExchangeRate(id)
    toast.success('Tasa eliminada')
  } catch {
    toast.error('No se pudo eliminar la tasa')
  }
}

export function ExchangeRatesPage() {
  const rates = useExchangeRates()

  return (
    <div className="flex flex-col gap-6">
      <Link to="/ajustes" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Ajustes
      </Link>

      <PageHeader
        title="Tasas de cambio"
        description="Cargadas a mano, usadas para consolidar Dashboard y Reportes a tu moneda base."
      />

      <ExchangeRateForm />

      {rates === undefined ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : rates.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Todavía no cargaste ninguna tasa"
          description="Sin tasas, los movimientos y cuentas en otra moneda no se pueden consolidar."
        />
      ) : (
        <div className="rounded-xl border border-border px-3">
          {rates.map((rate) => (
            <div key={rate.id} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
              <p className="w-24 shrink-0 text-sm text-muted-foreground">{rate.date}</p>
              <p className="min-w-0 flex-1 truncate text-sm">
                {rate.from} → {rate.to}:{' '}
                <span className="font-medium">
                  {rate.rate.toLocaleString('es-AR', { maximumFractionDigits: 4 })}
                </span>
              </p>
              <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => void handleDelete(rate.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
