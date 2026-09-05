import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Eye, EyeOff, Receipt, TrendingUp, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExpenseByCategoryChart } from '@/components/ExpenseByCategoryChart'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { CategoryIcon } from '@/components/CategoryIcon'
import { MoneyTrendChart } from '@/components/MoneyTrendChart'
import { settingsRepo } from '@/database/repositories'
import { cn } from '@/lib/cn'
import { formatMonthLabel, shiftMonth } from '@/lib/dates'
import { percentChange } from '@/domain/money'
import { useMonthSummary } from '@/features/reports/hooks/useMonthSummary'
import { useExpenseByCategory } from '@/features/reports/hooks/useExpenseByCategory'
import { useExpenseHistory } from '@/features/reports/hooks/useExpenseHistory'
import { useNetWorthSummary } from '@/features/networth/hooks/useNetWorthSummary'
import { useSavingsAndInvestmentsHistory } from '@/features/networth/hooks/useSavingsAndInvestmentsHistory'
import { useBudgetsWithProgress } from '@/features/budgets/hooks/useBudgetsWithProgress'
import { useDashboardUiStore } from '../store'
import { useSettings } from '../hooks/useSettings'
import { VariationBadge } from '../components/VariationBadge'
import { MonthSelector } from '../components/MonthSelector'
import { PeriodSelect } from '../components/PeriodSelect'

const BUDGET_ALERT_THRESHOLD = 90

export function DashboardPage() {
  const settings = useSettings()
  const hideAmount = settings?.hideSavingsAndInvestmentsAmount ?? false
  // Sólo las tarjetas de gasto siguen este mes — Ahorro e inversiones y su
  // progreso siempre muestran hoy, ver docs/DECISIONS.md.
  const month = useDashboardUiStore((s) => s.month)
  const summary = useMonthSummary(month)
  const previousSummary = useMonthSummary(shiftMonth(month, -1))
  // Same source of truth as /patrimonio (Ahorro e Inversiones) — Ahorros +
  // Inversiones, deliberately not Cuentas (ya no existen). See
  // docs/DECISIONS.md "Ahorro e Inversiones deja de incluir Cuentas".
  const savingsAndInvestments = useNetWorthSummary()
  const expenseByCategory = useExpenseByCategory(month)
  const budgets = useBudgetsWithProgress(month)
  const budgetsToReview = budgets?.items.filter((b) => b.progress.percentUsed >= BUDGET_ALERT_THRESHOLD).slice(0, 3)
  const hasCategoryData = expenseByCategory !== undefined && expenseByCategory.items.length > 0

  const [expenseMonthsBack, setExpenseMonthsBack] = useState(6)
  const expenseHistory = useExpenseHistory(expenseMonthsBack, month)
  const expenseHistoryPoints = expenseHistory?.points.map((p) => ({ month: p.month, value: p.expense }))
  const hasExpenseHistory = expenseHistoryPoints !== undefined && expenseHistoryPoints.some((p) => p.value.amount !== 0)

  const [investmentMonthsBack, setInvestmentMonthsBack] = useState(6)
  const investmentsHistory = useSavingsAndInvestmentsHistory(investmentMonthsBack)
  const investmentPoints = investmentsHistory?.points.map((p) => ({ month: p.month, value: p.byBucket.investments }))
  const hasInvestmentProgress = investmentPoints !== undefined && investmentPoints.some((p) => p.value.amount !== 0)
  const firstInvestmentPoint = investmentPoints?.[0]
  const lastInvestmentPoint = investmentPoints?.[investmentPoints.length - 1]
  const investmentChange =
    firstInvestmentPoint && lastInvestmentPoint
      ? percentChange(firstInvestmentPoint.value, lastInvestmentPoint.value)
      : undefined
  // "Ahorro e inversiones" KPI badge, month-over-month — independiente del
  // período elegido arriba: los puntos siempre son mensuales y consecutivos
  // terminando en hoy, así que los dos últimos son siempre "mes anterior
  // vs. mes actual" sea cual sea investmentMonthsBack. Mismo fetch que ya
  // alimenta el gráfico, no hace falta otra consulta.
  const previousInvestmentPoint = investmentPoints?.[investmentPoints.length - 2]
  const investmentMonthChange =
    previousInvestmentPoint && lastInvestmentPoint
      ? percentChange(previousInvestmentPoint.value, lastInvestmentPoint.value)
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
        actions={<MonthSelector />}
      />

      <MissingRateBanner
        count={missingRateCount}
        itemLabel={['gasto, ahorro o inversión', 'gastos, ahorros o inversiones']}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 px-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Receipt className="size-6" />
              </div>
              <div>
                {/* h-6 matches the eye-toggle Button's own height in the
                    "Ahorro e inversiones" card below — without it, that
                    card's label row is taller (icon-xs button vs. bare
                    text), so centering each content block independently
                    in two equal-height cards lands them at different
                    vertical offsets. */}
                <div className="flex h-6 items-center">
                  <p className="text-xs text-muted-foreground">Gastos del mes</p>
                </div>
                <p className="mt-1 text-xl font-semibold">
                  {summary ? <MoneyText value={summary.expense} /> : <span className="text-muted-foreground">—</span>}
                </p>
              </div>
            </div>
            {expenseChange !== undefined && (
              <div className="flex shrink-0 flex-col items-end">
                <VariationBadge percent={expenseChange} invert />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between gap-3 px-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="size-6" />
              </div>
              <div>
                <div className="flex h-6 items-center gap-1">
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
            </div>
            {investmentMonthChange !== undefined && (
              <div className="flex shrink-0 flex-col items-end">
                <VariationBadge percent={investmentMonthChange} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
          animates to the content's actual height instead of a guessed cap. */}
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
                <CardAction>
                  <PeriodSelect value={investmentMonthsBack} onChange={setInvestmentMonthsBack} />
                </CardAction>
              </CardHeader>
              <CardContent>
                <MoneyTrendChart points={investmentPoints} height={220} showYAxis />
                {investmentChange !== undefined && (
                  <VariationBadge percent={investmentChange} compareLabel={`hace ${investmentMonthsBack - 1} meses`} />
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
                <CardAction>
                  <PeriodSelect value={expenseMonthsBack} onChange={setExpenseMonthsBack} />
                </CardAction>
              </CardHeader>
              <CardContent>
                <MoneyTrendChart points={expenseHistoryPoints} height={220} showYAxis />
                {expenseChange !== undefined && <VariationBadge percent={expenseChange} invert />}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
