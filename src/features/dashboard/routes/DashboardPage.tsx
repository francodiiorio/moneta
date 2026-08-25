import { Link } from 'react-router'
import { LayoutDashboard, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExpenseByCategoryChart } from '@/components/ExpenseByCategoryChart'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { cn } from '@/lib/cn'
import { currentMonthStamp, formatMonthLabel, shiftMonth } from '@/lib/dates'
import { percentChange } from '@/domain/money'
import { useMonthSummary } from '@/features/reports/hooks/useMonthSummary'
import { useExpenseByCategory } from '@/features/reports/hooks/useExpenseByCategory'
import { useNetWorthSummary } from '@/features/networth/hooks/useNetWorthSummary'
import { useBudgetsWithProgress } from '@/features/budgets/hooks/useBudgetsWithProgress'
import { useHasAccounts } from '../hooks/useHasAccounts'
import { useRecentExpenses } from '../hooks/useRecentExpenses'
import { RecentExpensesList } from '../components/RecentExpensesList'
import { VariationBadge } from '../components/VariationBadge'

const BUDGET_ALERT_THRESHOLD = 90

export function DashboardPage() {
  const hasAccounts = useHasAccounts()
  const month = currentMonthStamp()
  const summary = useMonthSummary(month)
  const previousSummary = useMonthSummary(shiftMonth(month, -1))
  // Same source of truth as /patrimonio — Cuentas + Ahorros + Inversiones,
  // not just Cuentas (features/reports:getCurrentNetWorth predates the
  // Patrimonio module and never learned about the other two).
  const netWorth = useNetWorthSummary()
  const expenseByCategory = useExpenseByCategory(month)
  const recentExpenses = useRecentExpenses(month)
  const budgets = useBudgetsWithProgress(month)
  const budgetsToReview = budgets?.items.filter((b) => b.progress.percentUsed >= BUDGET_ALERT_THRESHOLD).slice(0, 3)
  const hasCategoryData = expenseByCategory !== undefined && expenseByCategory.items.length > 0
  const hasRecentExpenses = recentExpenses !== undefined && recentExpenses.length > 0

  const incomeChange =
    summary && previousSummary ? percentChange(previousSummary.income, summary.income) : undefined
  const expenseChange =
    summary && previousSummary ? percentChange(previousSummary.expense, summary.expense) : undefined

  const missingRateCount = (summary?.missingRateCount ?? 0) + (netWorth?.missingRateCount ?? 0)

  if (hasAccounts === false) {
    return (
      <div className="flex flex-col gap-4">
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
    <div className="flex flex-col gap-4">
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
            {incomeChange !== undefined && <VariationBadge percent={incomeChange} />}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Gastos del mes</p>
            <p className="mt-1 text-xl font-semibold">
              {summary ? <MoneyText value={summary.expense} /> : <span className="text-muted-foreground">—</span>}
            </p>
            {expenseChange !== undefined && <VariationBadge percent={expenseChange} invert />}
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
              {netWorth ? <MoneyText value={netWorth.total} /> : <span className="text-muted-foreground">—</span>}
            </p>
          </CardContent>
        </Card>
      </div>

      {budgetsToReview !== undefined && budgetsToReview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-negative" />
              Presupuestos a revisar
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {budgetsToReview.map((item) => (
              <Link
                key={item.budgetId}
                to="/presupuestos"
                className="flex items-center justify-between text-sm hover:text-foreground"
              >
                <span className="text-muted-foreground">{item.categoryName}</span>
                <span className={item.progress.isOverBudget ? 'font-medium text-negative' : 'font-medium'}>
                  {Math.round(item.progress.percentUsed)}% usado
                </span>
              </Link>
            ))}
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
