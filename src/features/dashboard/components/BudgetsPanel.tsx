import { Target } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { MoneyText } from '@/components/MoneyText'
import { cn } from '@/lib/cn'
import type { MonthStamp } from '@/lib/dates'
import { useBudgetsWithProgress } from '@/features/budgets/hooks/useBudgetsWithProgress'
import { BUDGET_NEAR_LIMIT_PERCENT } from '@/features/budgets/service'
import { Panel, PanelEmpty } from './Panel'


export function BudgetsPanel({ month }: { month: MonthStamp }) {
  const budgets = useBudgetsWithProgress(month)
  // Most used first: what needs a look comes up top.
  const items = budgets?.items.slice().sort((a, b) => b.progress.percentUsed - a.progress.percentUsed).slice(0, 4)

  return (
    <Panel title="Presupuestos" icon={Target} to="/presupuestos">
      {items === undefined ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : items.length === 0 && (budgets?.missingRateCount ?? 0) > 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          No se pudieron convertir tus presupuestos por falta de tasa de cambio.
        </p>
      ) : items.length === 0 ? (
        <PanelEmpty text="Poné un tope por categoría y seguí cuánto llevás." to="/presupuestos" action="Armar un presupuesto" />
      ) : (
        <div className="flex flex-col gap-3">
          {(budgets?.missingRateCount ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              Faltan tasas de cambio: algún presupuesto no se muestra o está incompleto.
            </p>
          )}
          {items.map((item) => {
            const { progress } = item
            const isNear = !progress.isOverBudget && progress.percentUsed >= BUDGET_NEAR_LIMIT_PERCENT
            return (
              <div key={item.budgetId}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size="sm" />
                    <span className="truncate">{item.categoryName}</span>
                  </span>
                  <span className={cn('shrink-0 text-xs font-medium', progress.isOverBudget && 'text-negative')}>
                    {Math.round(progress.percentUsed)}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      progress.isOverBudget ? 'bg-negative' : isNear ? 'bg-negative/60' : 'bg-primary',
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, progress.percentUsed))}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  <MoneyText value={progress.actual} /> de <MoneyText value={progress.budget} />
                </p>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
