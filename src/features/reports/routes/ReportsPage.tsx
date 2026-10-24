import { Link } from 'react-router'
import { BarChart3, ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CategoryBreakdownChart } from '@/components/CategoryBreakdownChart'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { MissingPriceBanner } from '@/components/MissingPriceBanner'
import { formatMonthLabel, shiftMonth } from '@/lib/dates'
import { useReportsUiStore } from '../store'
import { useMonthSummary } from '../hooks/useMonthSummary'
import { useExpenseByCategory } from '../hooks/useExpenseByCategory'
import { useIncomeByCategory } from '../hooks/useIncomeByCategory'
import { useMonthFlowHistory } from '../hooks/useMonthFlowHistory'
import { useNetWorthHistory } from '../hooks/useNetWorthHistory'
import { NetWorthChart } from '../components/NetWorthChart'

const UNCONVERTED = 'No se pudieron convertir por falta de tasa de cambio.'

export function ReportsPage() {
  const month = useReportsUiStore((s) => s.month)
  const setMonth = useReportsUiStore((s) => s.setMonth)

  const summary = useMonthSummary(month)
  const expenseByCategory = useExpenseByCategory(month)
  const incomeByCategory = useIncomeByCategory(month)
  const flowHistory = useMonthFlowHistory(6, month)
  const netWorthHistory = useNetWorthHistory(6)

  // The 6-month table ends at the selected month, so its misses include
  // summary's (and the by-category scans read the same movements) —
  // counting only the widest one never double-counts a movement.
  const flowMisses = flowHistory?.missingRateCount ?? summary?.missingRateCount ?? 0
  const missingRateCount = flowMisses + (netWorthHistory?.missingRateCount ?? 0)

  const hasFlowHistory =
    flowHistory?.points.some((p) => p.income.amount !== 0 || p.expense.amount !== 0 || p.partial) ?? false
  // A month whose only movements lack a rate isn't empty: it's unconverted.
  const hasMovementsThisMonth =
    summary && (summary.expense.amount > 0 || summary.income.amount > 0 || summary.missingRateCount > 0)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Reportes"
        description="Ingresos, gastos y balance de cada mes, por categoría, y la evolución de tu patrimonio."
      />

      <MissingRateBanner count={missingRateCount} itemLabel={['monto', 'montos']} />

      {/* flex-wrap: same pattern as TransactionsPage's month navigator row
          — "Exportar informe" (icon + two-word label) doesn't fit next to
          the two icon buttons + label on a narrow mobile viewport, and
          Button's own shrink-0/whitespace-nowrap means it can't shrink to
          fit; wrapping to a second line beats overflowing horizontally. */}
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="icon" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium capitalize">{formatMonthLabel(month)}</span>
        <Button variant="ghost" size="icon" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="size-4" />
        </Button>
        {/* Same tab, not a new one: keeps the selected month (state lives in
            useReportsUiStore, not the URL) so the browser's back button
            returns here instead of reloading the whole app. */}
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link to={`/reportes/informe/${month}`}>
            <FileText className="size-4" />
            Exportar informe
          </Link>
        </Button>
      </div>

      {summary && (
        // lg, not sm: from md the sidebar leaves too little room for three
        // ARS amounts side by side (they can't wrap).
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="py-0">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Ingresos</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.income} />
              </p>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Gastos</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.expense} />
              </p>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Balance neto</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.net} signColor />
              </p>
              {summary.missingRateCount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Parcial: faltan tasas de cambio.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {summary !== undefined && !hasMovementsThisMonth ? (
        <EmptyState
          icon={BarChart3}
          title="No hay movimientos este mes"
          description="Cargá gastos e ingresos en Movimientos para ver el desglose por categoría."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Gasto por categoría</CardTitle>
            </CardHeader>
            <CardContent>
              {expenseByCategory === undefined ? (
                <div className="h-48 animate-pulse rounded-lg bg-muted" />
              ) : (
                <CategoryBreakdownChart
                  items={expenseByCategory.items}
                  emptyLabel={expenseByCategory.missingRateCount > 0 ? UNCONVERTED : 'Sin gastos este mes.'}
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ingreso por categoría</CardTitle>
            </CardHeader>
            <CardContent>
              {incomeByCategory === undefined ? (
                <div className="h-48 animate-pulse rounded-lg bg-muted" />
              ) : (
                <CategoryBreakdownChart
                  items={incomeByCategory.items}
                  emptyLabel={incomeByCategory.missingRateCount > 0 ? UNCONVERTED : 'Sin ingresos este mes.'}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>6 meses hasta {formatMonthLabel(month).toLowerCase()}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {flowHistory === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : !hasFlowHistory ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Todavía no hay ingresos ni gastos en estos meses.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-1.5 font-normal">Mes</th>
                    <th className="py-1.5 pl-3 text-right font-normal">Ingresos</th>
                    <th className="py-1.5 pl-3 text-right font-normal">Gastos</th>
                    <th className="py-1.5 pl-3 text-right font-normal">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {flowHistory.points.map((point) => (
                    <tr key={point.month} className={point.month === month ? 'font-medium' : undefined}>
                      <td className="py-1.5 whitespace-nowrap">{formatMonthLabel(point.month)}</td>
                      <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                        <MoneyText value={point.income} />
                      </td>
                      <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                        <MoneyText value={point.expense} />
                      </td>
                      <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                        <MoneyText value={point.net} signColor />
                        {/* Reserved on every row so the amounts stay aligned. */}
                        <span
                          className="inline-block w-2 text-muted-foreground"
                          title={point.partial ? 'Parcial: faltan tasas de cambio' : undefined}
                        >
                          {point.partial ? '*' : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Balance = ingresos − gastos del mes (* parcial: faltan tasas de cambio). Los gastos con
            tarjeta cuentan en el mes de la compra, no del pago del resumen; transferencias, pagos de
            resumen y compras de inversión no son gasto ni ingreso.
          </p>
        </CardContent>
      </Card>

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
                  Cuentas: saldo real a fin de cada mes. Ahorros e inversiones: cantidad actual,
                  valuada al precio y tipo de cambio de cada mes — no reflejan cuánto tenías cargado
                  en ese momento.
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
