import { Link } from 'react-router'
import { BarChart3, ChevronLeft, ChevronRight, FileText } from 'lucide-react'
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

      {/* One card, not three — same reasoning as the Dashboard's stat row
          (see docs/PRODUCT.md "Calma antes que densidad"): three numbers
          read together at a glance, not three separately bordered boxes.
          Divider only from lg:+, same breakpoint as Dashboard's, so the
          extra padding it needs doesn't tighten the column right at the
          point 3 columns first appear (sm:). This narrows, not removes,
          a pre-existing overflow risk for a very long amount at ~768-850px
          — the three-separate-Card layout had the same risk, slightly
          worse (see the review that flagged this — money is never
          truncated, so an amount long enough can still overflow its
          column in that range; not something this change introduced or
          fully closes). */}
      {summary && (
        <Card className="py-0">
          <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-border">
            <div className="lg:px-4 lg:first:pl-0 lg:last:pr-0">
              <p className="text-xs text-muted-foreground">Ingresos</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.income} />
              </p>
            </div>
            <div className="lg:px-4 lg:first:pl-0 lg:last:pr-0">
              <p className="text-xs text-muted-foreground">Gastos</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.expense} />
              </p>
            </div>
            <div className="lg:px-4 lg:first:pl-0 lg:last:pr-0">
              <p className="text-xs text-muted-foreground">Balance neto</p>
              <p className="mt-1 text-lg font-semibold">
                <MoneyText value={summary.net} signColor />
              </p>
            </div>
          </CardContent>
        </Card>
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
