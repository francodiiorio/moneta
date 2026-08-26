import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExpenseByCategoryChart } from '@/components/ExpenseByCategoryChart'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { MissingPriceBanner } from '@/components/MissingPriceBanner'
import { formatMonthLabel, shiftMonth } from '@/lib/dates'
import { useReportsUiStore } from '../store'
import { useMonthSummary } from '../hooks/useMonthSummary'
import { useExpenseByCategory } from '../hooks/useExpenseByCategory'
import { useNetWorthHistory } from '../hooks/useNetWorthHistory'
import { NetWorthChart } from '../components/NetWorthChart'

export function ReportsPage() {
  const month = useReportsUiStore((s) => s.month)
  const setMonth = useReportsUiStore((s) => s.setMonth)

  const summary = useMonthSummary(month)
  const expenseByCategory = useExpenseByCategory(month)
  const netWorthHistory = useNetWorthHistory(6)

  // expenseByCategory scans the same confirmed expense transactions as
  // summary (same month, same conversion), so its misses are always a
  // subset of summary's — adding both would double-count the same
  // transaction. summary already covers expenses *and* income misses.
  const missingRateCount = (summary?.missingRateCount ?? 0) + (netWorthHistory?.missingRateCount ?? 0)

  const hasMovementsThisMonth = summary && (summary.income.amount > 0 || summary.expense.amount > 0)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reportes" description="Gasto por categoría y evolución de tu patrimonio." />

      <MissingRateBanner count={missingRateCount} />

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium capitalize">{formatMonthLabel(month)}</span>
        <Button variant="ghost" size="icon" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent>
              <p className="text-xs text-muted-foreground">Ingresos</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.income} />
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-xs text-muted-foreground">Gastos</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.expense} />
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-xs text-muted-foreground">Balance neto</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.net} signColor />
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {summary !== undefined && !hasMovementsThisMonth ? (
        <EmptyState
          icon={BarChart3}
          title="No hay movimientos este mes"
          description="Cargá ingresos y gastos en Movimientos para ver el desglose por categoría."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Gasto por categoría</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseByCategory === undefined ? (
              <div className="h-48 animate-pulse rounded-lg bg-muted" />
            ) : (
              <ExpenseByCategoryChart items={expenseByCategory.items} />
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Evolución del patrimonio</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {netWorthHistory === undefined ? (
              <div className="h-56 animate-pulse rounded-lg bg-muted" />
            ) : (
              <>
                <NetWorthChart points={netWorthHistory.points} />
                <p className="text-xs text-muted-foreground">
                  Cuentas: balance real de cada mes. Ahorros e inversiones: cantidad actual, valuada al
                  precio y tipo de cambio de cada mes — no reflejan cuánto tenías cargado en ese momento.
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <MissingPriceBanner count={netWorthHistory?.missingPriceCount ?? 0} />
      </div>
    </div>
  )
}
