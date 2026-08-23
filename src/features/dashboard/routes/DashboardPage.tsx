import { LayoutDashboard } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Card, CardContent } from '@/components/ui/card'
import { currentMonthStamp, formatMonthLabel } from '@/lib/dates'
import { useMonthSummary } from '@/features/reports/hooks/useMonthSummary'
import { useCurrentNetWorth } from '@/features/reports/hooks/useCurrentNetWorth'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { useHasAccounts } from '../hooks/useHasAccounts'

export function DashboardPage() {
  const hasAccounts = useHasAccounts()
  const month = currentMonthStamp()
  const summary = useMonthSummary(month)
  const netWorth = useCurrentNetWorth()

  const missingRateCount = (summary?.missingRateCount ?? 0) + (netWorth?.missingRateCount ?? 0)

  if (hasAccounts === false) {
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={`Resumen de ${formatMonthLabel(month).toLowerCase()} y tu patrimonio total.`}
      />

      <MissingRateBanner count={missingRateCount} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Ingresos del mes</p>
            <p className="mt-1 text-xl font-semibold">
              {summary ? <MoneyText value={summary.income} /> : <span className="text-muted-foreground">—</span>}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Gastos del mes</p>
            <p className="mt-1 text-xl font-semibold">
              {summary ? <MoneyText value={summary.expense} /> : <span className="text-muted-foreground">—</span>}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Balance neto</p>
            <p className="mt-1 text-xl font-semibold">
              {summary ? (
                <MoneyText value={summary.net} signColor />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Patrimonio total</p>
            <p className="mt-1 text-xl font-semibold">
              {netWorth ? <MoneyText value={netWorth.netWorth} /> : <span className="text-muted-foreground">—</span>}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
