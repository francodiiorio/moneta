import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownLeft, BarChart3, Eye, EyeOff, PieChart, Receipt, Scale, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CategoryBreakdownChart } from '@/components/CategoryBreakdownChart'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { MoneyTrendChart } from '@/components/MoneyTrendChart'
import { settingsRepo } from '@/database/repositories'
import { cn } from '@/lib/cn'
import { formatMonthLabel, shiftMonth } from '@/lib/dates'
import { percentChange } from '@/domain/money'
import { useMonthSummary } from '@/features/reports/hooks/useMonthSummary'
import { useExpenseByCategory } from '@/features/reports/hooks/useExpenseByCategory'
import { useMonthFlowHistory } from '@/features/reports/hooks/useMonthFlowHistory'
import { useNetWorthSummary } from '@/features/networth/hooks/useNetWorthSummary'
import { useNetWorthMonthChange } from '@/features/networth/hooks/useNetWorthMonthChange'
import { useSavingsAndInvestmentsHistory } from '@/features/networth/hooks/useSavingsAndInvestmentsHistory'
import { useBudgetsWithProgress } from '@/features/budgets/hooks/useBudgetsWithProgress'
import { useDashboardUiStore } from '../store'
import { useSettings } from '../hooks/useSettings'
import { useOnboarding } from '../hooks/useOnboarding'
import { useOnboardingHidden } from '../hooks/useOnboardingHidden'
import { monthChange, savingsRate, type OnboardingStep } from '../service'
import { VariationBadge } from '../components/VariationBadge'
import { Variation } from '../components/Variation'
import { MonthSelector } from '../components/MonthSelector'
import { PeriodSelect } from '../components/PeriodSelect'
import { CardDeadlines } from '../components/CardDeadlines'
import { KpiCard } from '../components/KpiCard'
import { Panel } from '../components/Panel'
import { FlowChart } from '../components/FlowChart'
import { WelcomeHero } from '../components/WelcomeHero'
import { OnboardingChecklist } from '../components/OnboardingChecklist'
import { FeatureHighlights } from '../components/FeatureHighlights'
import { AccountsPanel } from '../components/AccountsPanel'
import { BudgetsPanel } from '../components/BudgetsPanel'
import { UpcomingPanel } from '../components/UpcomingPanel'
import { RecentMovementsPanel } from '../components/RecentMovementsPanel'

const percentFormat = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 0 })

function greeting(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 6 || hour >= 20) return 'Buenas noches'
  return hour < 13 ? 'Buen día' : 'Buenas tardes'
}

/** The home. With nothing loaded yet it's a welcome — what Moneta is and
 *  the first steps; from the first thing loaded on, the month at a glance. */
export function DashboardPage() {
  const onboarding = useOnboarding()

  if (onboarding === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-14 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  if (!onboarding.hasData) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={greeting()} description="Empecemos a ordenar tu plata." />
        <WelcomeHero />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <OnboardingChecklist steps={onboarding.steps} />
          <FeatureHighlights />
        </div>
      </div>
    )
  }

  return <MonthOverview steps={onboarding.steps} />
}

function MonthOverview({ steps }: { steps: OnboardingStep[] }) {
  const settings = useSettings()
  const hideAmount = settings?.hideSavingsAndInvestmentsAmount ?? false
  const [onboardingHidden, hideOnboarding] = useOnboardingHidden()
  // The month drives what happened (ingresos, gastos, categorías,
  // presupuestos); Patrimonio, cuentas, tarjetas and "se viene" are always
  // today — same convention as /patrimonio (see docs/DECISIONS.md).
  const month = useDashboardUiStore((s) => s.month)
  const summary = useMonthSummary(month)
  const previousSummary = useMonthSummary(shiftMonth(month, -1))
  const netWorth = useNetWorthSummary()
  const netWorthMonthChange = useNetWorthMonthChange()
  const expenseByCategory = useExpenseByCategory(month)
  const flow = useMonthFlowHistory(6, month)
  const hasFlow = flow?.points.some((p) => p.income.amount !== 0 || p.expense.amount !== 0) ?? false

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

  const budgets = useBudgetsWithProgress(month)
  // A change against a partial month (or this one) would mislead: shown as
  // "Parcial" instead of a percent.
  const isPartial = (summary?.missingRateCount ?? 0) + (previousSummary?.missingRateCount ?? 0) > 0
  const incomeChange =
    summary && previousSummary
      ? monthChange(
          { total: previousSummary.income, missingRateCount: previousSummary.missingRateCount },
          { total: summary.income, missingRateCount: summary.missingRateCount },
        )
      : undefined
  const expenseChange =
    summary && previousSummary
      ? monthChange(
          { total: previousSummary.expense, missingRateCount: previousSummary.expenseMissingRateCount },
          { total: summary.expense, missingRateCount: summary.expenseMissingRateCount },
        )
      : undefined
  const rate = summary ? savingsRate(summary) : undefined
  // The 6-month chart ends at this month, so its misses include summary's;
  // a budget left out for lack of a rate is a miss of its own.
  const missingRateCount =
    (flow?.missingRateCount ?? summary?.missingRateCount ?? 0) +
    (netWorth?.missingRateCount ?? 0) +
    (budgets?.missingRateCount ?? 0)
  const showOnboarding = !onboardingHidden && steps.some((s) => !s.done)

  async function handleToggleHideAmount() {
    try {
      await settingsRepo.updateSettings({ hideSavingsAndInvestmentsAmount: !hideAmount })
    } catch {
      toast.error('No se pudo cambiar la preferencia')
    }
  }

  const loading = <span className="text-muted-foreground">—</span>

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={greeting()}
        description={`Así viene ${formatMonthLabel(month).toLowerCase()}.`}
        actions={<MonthSelector />}
      />

      <MissingRateBanner
        count={missingRateCount}
        itemLabel={['monto, cuenta, ahorro o inversión', 'montos, cuentas, ahorros o inversiones']}
      />

      {showOnboarding && <OnboardingChecklist steps={steps} compact onHide={hideOnboarding} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Ingresos"
          icon={ArrowDownLeft}
          tone="positive"
          value={summary ? <MoneyText value={summary.income} /> : loading}
          footer={summary && (isPartial ? 'Parcial: faltan tasas de cambio' : <Variation percent={incomeChange} />)}
        />
        <KpiCard
          label="Gastos"
          icon={Receipt}
          value={summary ? <MoneyText value={summary.expense} /> : loading}
          footer={
            summary &&
            ((summary.expenseMissingRateCount ?? 0) + (previousSummary?.expenseMissingRateCount ?? 0) > 0 ? (
              'Parcial: faltan tasas de cambio'
            ) : (
              <Variation percent={expenseChange} invert />
            ))
          }
        />
        <KpiCard
          label="Balance neto"
          icon={Scale}
          tone={summary === undefined ? 'primary' : summary.net.amount < 0 ? 'negative' : 'positive'}
          value={summary ? <MoneyText value={summary.net} signColor /> : loading}
          footer={
            summary &&
            (summary.missingRateCount > 0
              ? 'Parcial: faltan tasas de cambio'
              : rate === undefined
                ? 'Sin ingresos este mes'
                : rate >= 0
                  ? `Ahorraste ${percentFormat.format(rate)} de lo que entró`
                  : 'Gastaste más de lo que entró')
          }
        />
        <KpiCard
          label={
            <>
              Patrimonio
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void handleToggleHideAmount()}
                title={hideAmount ? 'Mostrar patrimonio y saldos' : 'Ocultar patrimonio y saldos'}
                aria-label={hideAmount ? 'Mostrar patrimonio y saldos' : 'Ocultar patrimonio y saldos'}
                aria-pressed={hideAmount}
              >
                {hideAmount ? <EyeOff /> : <Eye />}
              </Button>
            </>
          }
          icon={TrendingUp}
          value={
            // Both stay mounted and crossfade: a conditional render would
            // swap nodes and skip the transition.
            <div className="relative h-8">
              <span
                aria-hidden={!hideAmount}
                className={cn(
                  'absolute inset-0 font-mono text-muted-foreground tabular-nums transition-opacity duration-150',
                  hideAmount ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
              >
                ••••••
              </span>
              {/* aria-hidden too: opacity alone still reads it aloud. */}
              <span
                aria-hidden={hideAmount}
                className={cn(
                  'absolute inset-0 transition-opacity duration-150',
                  hideAmount ? 'pointer-events-none opacity-0' : 'opacity-100',
                )}
              >
                {netWorth ? <MoneyText value={netWorth.total} /> : loading}
              </span>
            </div>
          }
          footer={netWorth && <Variation percent={netWorthMonthChange} compareLabel="mes pasado" />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          title="Ingresos y gastos"
          icon={BarChart3}
          to="/reportes"
          linkLabel="Reportes"
          className="lg:col-span-2"
          fill
        >
          {flow === undefined ? (
            <div className="h-60 animate-pulse rounded-lg bg-muted" />
          ) : hasFlow ? (
            <FlowChart points={flow.points} />
          ) : (
            <p className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              Todavía no hay ingresos ni gastos en estos meses.
            </p>
          )}
        </Panel>
        <Panel title="En qué se fue" icon={PieChart} to="/reportes" linkLabel="Reportes">
          {expenseByCategory === undefined ? (
            <div className="h-60 animate-pulse rounded-lg bg-muted" />
          ) : (
            <CategoryBreakdownChart items={expenseByCategory.items} />
          )}
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AccountsPanel hideAmounts={hideAmount} />
        <CardDeadlines />
        <BudgetsPanel month={month} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <UpcomingPanel />
        <RecentMovementsPanel />
      </div>

      {/* Collapses smoothly with the eye (grid-rows 0fr/1fr) instead of
          unmounting: its tooltip shows the amounts the eye just hid. */}
      {hasInvestmentProgress && investmentPoints && (
        <div
          className={cn(
            'ease grid transition-[grid-template-rows] duration-200',
            hideAmount ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
          )}
        >
          {/* inert while collapsed: hidden content mustn't take the focus. */}
          <div className="overflow-hidden" inert={hideAmount}>
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
    </div>
  )
}
