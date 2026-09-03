import { Link } from 'react-router'
import { toast } from 'sonner'
import { Eye, EyeOff, LayoutDashboard, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExpenseByCategoryChart } from '@/components/ExpenseByCategoryChart'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { CategoryIcon } from '@/components/CategoryIcon'
import { MoneyTrendChart } from '@/components/MoneyTrendChart'
import { settingsRepo } from '@/database/repositories'
import { cn } from '@/lib/cn'
import { currentMonthStamp, formatMonthLabel, shiftMonth } from '@/lib/dates'
import { percentChange } from '@/domain/money'
import { useMonthSummary } from '@/features/reports/hooks/useMonthSummary'
import { useExpenseByCategory } from '@/features/reports/hooks/useExpenseByCategory'
import { useNetWorthSummary } from '@/features/networth/hooks/useNetWorthSummary'
import { useSavingsAndInvestmentsHistory } from '@/features/networth/hooks/useSavingsAndInvestmentsHistory'
import { useBudgetsWithProgress } from '@/features/budgets/hooks/useBudgetsWithProgress'
import { useHasAccounts } from '../hooks/useHasAccounts'
import { useRecentExpenses } from '../hooks/useRecentExpenses'
import { useSettings } from '../hooks/useSettings'
import { RecentExpensesList } from '../components/RecentExpensesList'
import { VariationBadge } from '../components/VariationBadge'

const BUDGET_ALERT_THRESHOLD = 90

export function DashboardPage() {
  const hasAccounts = useHasAccounts()
  const settings = useSettings()
  const hideAmount = settings?.hideSavingsAndInvestmentsAmount ?? false
  const month = currentMonthStamp()
  const summary = useMonthSummary(month)
  const previousSummary = useMonthSummary(shiftMonth(month, -1))
  // Same source of truth as /patrimonio (Ahorro e Inversiones) — Ahorros +
  // Inversiones, deliberately not Cuentas (ya tiene su propia página). See
  // docs/DECISIONS.md "Ahorro e Inversiones deja de incluir Cuentas".
  const savingsAndInvestments = useNetWorthSummary()
  const expenseByCategory = useExpenseByCategory(month)
  const recentExpenses = useRecentExpenses(month)
  const budgets = useBudgetsWithProgress(month)
  const budgetsToReview = budgets?.items.filter((b) => b.progress.percentUsed >= BUDGET_ALERT_THRESHOLD).slice(0, 3)
  const hasCategoryData = expenseByCategory !== undefined && expenseByCategory.items.length > 0
  const hasRecentExpenses = recentExpenses !== undefined && recentExpenses.length > 0

  const investmentsHistory = useSavingsAndInvestmentsHistory()
  const investmentPoints = investmentsHistory?.points.map((p) => ({ month: p.month, value: p.byBucket.investments }))
  const hasInvestmentProgress = investmentPoints !== undefined && investmentPoints.some((p) => p.value.amount !== 0)
  // 6 puntos (mes actual + 5 anteriores) -> el primero y el último están
  // a 5 meses de distancia, no 6 — de ahí el "hace 5 meses" del badge.
  const firstInvestmentPoint = investmentPoints?.[0]
  const lastInvestmentPoint = investmentPoints?.[investmentPoints.length - 1]
  const investmentChange =
    firstInvestmentPoint && lastInvestmentPoint
      ? percentChange(firstInvestmentPoint.value, lastInvestmentPoint.value)
      : undefined

  const incomeChange =
    summary && previousSummary ? percentChange(previousSummary.income, summary.income) : undefined
  const expenseChange =
    summary && previousSummary ? percentChange(previousSummary.expense, summary.expense) : undefined

  const missingRateCount = (summary?.missingRateCount ?? 0) + (savingsAndInvestments?.missingRateCount ?? 0)

  async function handleToggleHideAmount() {
    try {
      await settingsRepo.updateSettings({ hideSavingsAndInvestmentsAmount: !hideAmount })
    } catch {
      toast.error('No se pudo cambiar la preferencia')
    }
  }

  if (hasAccounts === false) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Dashboard" description="Resumen del mes, y de tus ahorros e inversiones." />
        <EmptyState
          icon={LayoutDashboard}
          title="Todavía no hay datos"
          description="Cargá tus cuentas y movimientos para ver el resumen acá."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboard"
        description={`Resumen de ${formatMonthLabel(month).toLowerCase()} y de tus ahorros e inversiones.`}
      />

      <MissingRateBanner
        count={missingRateCount}
        itemLabel={['movimiento, ahorro o inversión', 'movimientos, ahorros o inversiones']}
      />

      {/* One card, not four — the four numbers are read together at a
          glance (that's the point of a dashboard), so four separately
          bordered/shadowed boxes was pure visual noise for the same
          information. 4-column layout (and its divider) only from lg:+ —
          same breakpoint the old sm:grid-cols-2 lg:grid-cols-4 layout used.
          sm: is too aggressive: a 4-column row in the ~640-1024px range
          (tablet portrait, an unmaximized laptop window) doesn't leave
          enough width for a several-digit amount, and it clips instead of
          wrapping. Below lg: it's a 2x2 grid, where a vertical divide
          would fall in the wrong place anyway (Tailwind's divide-x is
          DOM-adjacency-based, not row-aware). */}
      <Card className="py-0">
        <CardContent className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-border">
          <div className="lg:px-4 lg:first:pl-0 lg:last:pr-0">
            <p className="text-xs text-muted-foreground">Ingresos del mes</p>
            <p className="mt-1 text-xl font-semibold">
              {summary ? <MoneyText value={summary.income} /> : <span className="text-muted-foreground">—</span>}
            </p>
            {incomeChange !== undefined && <VariationBadge percent={incomeChange} />}
          </div>
          <div className="lg:px-4 lg:first:pl-0 lg:last:pr-0">
            <p className="text-xs text-muted-foreground">Gastos del mes</p>
            <p className="mt-1 text-xl font-semibold">
              {summary ? <MoneyText value={summary.expense} /> : <span className="text-muted-foreground">—</span>}
            </p>
            {expenseChange !== undefined && <VariationBadge percent={expenseChange} invert />}
          </div>
          <div className="lg:px-4 lg:first:pl-0 lg:last:pr-0">
            <p className="text-xs text-muted-foreground">Balance neto</p>
            <p className="mt-1 text-xl font-semibold">
              {summary ? (
                <MoneyText value={summary.net} signColor />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
          <div className="lg:px-4 lg:first:pl-0 lg:last:pr-0">
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">Ahorro e inversiones</p>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void handleToggleHideAmount()}
                title={hideAmount ? 'Mostrar monto' : 'Ocultar monto'}
              >
                {hideAmount ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            <p className="mt-1 text-xl font-semibold">
              {hideAmount ? (
                <span className="font-mono tabular-nums text-muted-foreground">••••••</span>
              ) : savingsAndInvestments ? (
                <MoneyText value={savingsAndInvestments.total} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Same visual family as MissingRateBanner/MissingPriceBanner — a
          heads-up, not a content section, so it doesn't get full Card
          chrome (border + shadow + header) competing with the chart/list
          cards below for attention. */}
      {budgetsToReview !== undefined && budgetsToReview.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4 text-negative" />
            Presupuestos a revisar
          </p>
          <div className="flex flex-col gap-1.5">
            {budgetsToReview.map((item) => (
              <Link
                key={item.budgetId}
                to="/presupuestos"
                className="flex items-center justify-between gap-3 text-sm hover:text-foreground"
              >
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size="sm" />
                  <span className="truncate">{item.categoryName}</span>
                </span>
                <span className={cn('shrink-0 font-medium', item.progress.isOverBudget && 'text-negative')}>
                  {Math.round(item.progress.percentUsed)}% usado
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Gated on !hideAmount too — el tooltip de MoneyTrendChart muestra
          montos reales de la misma serie que "Ahorro e inversiones" recién
          ocultó arriba; mostrar la card acá volvería a filtrarlos. */}
      {!hideAmount && hasInvestmentProgress && investmentPoints && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progreso de tus inversiones</CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyTrendChart points={investmentPoints} height={180} />
            {investmentChange !== undefined && (
              <VariationBadge percent={investmentChange} compareLabel="hace 5 meses" />
            )}
          </CardContent>
        </Card>
      )}

      {(hasCategoryData || hasRecentExpenses) && (
        <div className={cn('grid gap-3', hasCategoryData && hasRecentExpenses && 'lg:grid-cols-2')}>
          {hasCategoryData && expenseByCategory && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Gasto por categoría este mes</CardTitle>
              </CardHeader>
              <CardContent>
                <ExpenseByCategoryChart items={expenseByCategory.items} />
              </CardContent>
            </Card>
          )}

          {hasRecentExpenses && recentExpenses && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Últimos gastos del mes</CardTitle>
              </CardHeader>
              <CardContent>
                <RecentExpensesList items={recentExpenses} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
