import { Link } from 'react-router'
import { toast } from 'sonner'
import { Eye, EyeOff, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
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
import { useExpenseHistory } from '@/features/reports/hooks/useExpenseHistory'
import { useNetWorthSummary } from '@/features/networth/hooks/useNetWorthSummary'
import { useSavingsAndInvestmentsHistory } from '@/features/networth/hooks/useSavingsAndInvestmentsHistory'
import { useBudgetsWithProgress } from '@/features/budgets/hooks/useBudgetsWithProgress'
import { useSettings } from '../hooks/useSettings'
import { VariationBadge } from '../components/VariationBadge'

const BUDGET_ALERT_THRESHOLD = 90

export function DashboardPage() {
  const settings = useSettings()
  const hideAmount = settings?.hideSavingsAndInvestmentsAmount ?? false
  const month = currentMonthStamp()
  const summary = useMonthSummary(month)
  const previousSummary = useMonthSummary(shiftMonth(month, -1))
  // Same source of truth as /patrimonio (Ahorro e Inversiones) — Ahorros +
  // Inversiones, deliberately not Cuentas (ya no existen). See
  // docs/DECISIONS.md "Ahorro e Inversiones deja de incluir Cuentas".
  const savingsAndInvestments = useNetWorthSummary()
  const expenseByCategory = useExpenseByCategory(month)
  const expenseHistory = useExpenseHistory(6)
  const budgets = useBudgetsWithProgress(month)
  const budgetsToReview = budgets?.items.filter((b) => b.progress.percentUsed >= BUDGET_ALERT_THRESHOLD).slice(0, 3)
  const hasCategoryData = expenseByCategory !== undefined && expenseByCategory.items.length > 0
  const expenseHistoryPoints = expenseHistory?.points.map((p) => ({ month: p.month, value: p.expense }))
  const hasExpenseHistory = expenseHistoryPoints !== undefined && expenseHistoryPoints.some((p) => p.value.amount !== 0)

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboard"
        description={`Resumen de ${formatMonthLabel(month).toLowerCase()} y de tus ahorros e inversiones.`}
      />

      <MissingRateBanner
        count={missingRateCount}
        itemLabel={['gasto, ahorro o inversión', 'gastos, ahorros o inversiones']}
      />

      {/* One card, not two — mismo criterio que el resto del Dashboard: los
          números se leen juntos de un vistazo. Divider sólo desde sm:+. */}
      <Card className="py-0">
        <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-border">
          <div className="sm:px-4 sm:first:pl-0 sm:last:pr-0">
            <p className="text-xs text-muted-foreground">Gastos del mes</p>
            <p className="mt-1 text-xl font-semibold">
              {summary ? <MoneyText value={summary.expense} /> : <span className="text-muted-foreground">—</span>}
            </p>
          </div>
          <div className="sm:px-4 sm:first:pl-0 sm:last:pr-0">
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
            {/* Both spans stay mounted, stacked via absolute inset-0, and
                crossfade on opacity — a conditional render would swap DOM
                nodes outright and skip the transition entirely. h-7 gives
                the wrapper an explicit height since neither absolutely
                positioned child contributes one of its own. */}
            <div className="relative mt-1 h-7 text-xl font-semibold">
              <span
                className={cn(
                  'absolute inset-0 font-mono tabular-nums text-muted-foreground transition-opacity duration-150',
                  hideAmount ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
              >
                ••••••
              </span>
              <span
                className={cn(
                  'absolute inset-0 transition-opacity duration-150',
                  hideAmount ? 'pointer-events-none opacity-0' : 'opacity-100',
                )}
              >
                {savingsAndInvestments ? (
                  <MoneyText value={savingsAndInvestments.total} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </div>
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

      {/* Gated on hasInvestmentProgress only — that's a real "nothing to
          show" case (no unmount transition needed). hideAmount, on the
          other hand, is a user toggle (the eye icon above), so it collapses
          the card smoothly instead of mounting/unmounting it outright: the
          tooltip here shows the real amounts behind the same total the eye
          just hid, and an abrupt disappearance read as a glitch rather
          than a deliberate hide. Grid-rows 0fr/1fr, not max-height: it
          animates to the content's actual height instead of a guessed cap
          (see CLAUDE.md-adjacent precedent in ExpenseByCategoryChart's
          `.pie-legend`, which used max-height because its content is
          capped anyway — this content isn't). */}
      {hasInvestmentProgress && investmentPoints && (
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200 ease',
            hideAmount ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
          )}
        >
          <div className="overflow-hidden">
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
          </div>
        </div>
      )}

      {(hasCategoryData || hasExpenseHistory) && (
        <div className={cn('grid items-start gap-3', hasCategoryData && hasExpenseHistory && 'lg:grid-cols-2')}>
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

          {hasExpenseHistory && expenseHistoryPoints && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Evolución de gastos</CardTitle>
              </CardHeader>
              <CardContent>
                <MoneyTrendChart points={expenseHistoryPoints} height={220} />
                {expenseChange !== undefined && <VariationBadge percent={expenseChange} invert />}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
