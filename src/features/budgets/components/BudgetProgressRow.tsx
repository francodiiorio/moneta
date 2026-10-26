import { Pencil, Trash2 } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import { cn } from '@/lib/cn'
import { BUDGET_NEAR_LIMIT_PERCENT, type BudgetProgressItem } from '../service'

interface BudgetProgressRowProps {
  item: BudgetProgressItem
  onEdit: () => void
  onDelete: () => void
}

export function BudgetProgressRow({ item, onEdit, onDelete }: BudgetProgressRowProps) {
  const { progress } = item
  const barWidth = Math.min(100, Math.max(0, progress.percentUsed))
  // Committed spend (cuotas and recurring gastos to come) is drawn after
  // what's spent, fainter.
  const committedWidth = Math.min(100 - barWidth, Math.max(0, progress.percentCommitted))
  const hasCommitted = progress.committed.amount > 0
  const wouldExceed = progress.free.amount < 0
  const isNearLimit = !progress.isOverBudget && progress.percentUsed >= BUDGET_NEAR_LIMIT_PERCENT

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size="sm" />
          <p className="truncate font-medium">{item.categoryName}</p>
          <Badge variant="secondary">{item.period === 'monthly' ? 'Mensual' : 'Anual'}</Badge>
        </div>
        <div className="flex shrink-0">
          <Button variant="ghost" size="icon" aria-label={`Editar presupuesto de ${item.categoryName}`} onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Borrar presupuesto de ${item.categoryName}`} onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full transition-all',
            progress.isOverBudget ? 'bg-negative' : isNearLimit ? 'bg-negative/60' : 'bg-primary',
          )}
          style={{ width: `${barWidth}%` }}
        />
        {committedWidth > 0 && (
          <div
            className={cn('h-full transition-all', wouldExceed ? 'bg-negative/30' : 'bg-primary/30')}
            style={{ width: `${committedWidth}%` }}
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          <MoneyText value={progress.actual} /> de <MoneyText value={progress.budget} />
        </span>
        <span className={cn('font-medium', progress.isOverBudget && 'text-negative')}>
          {Math.round(progress.percentUsed)}%
        </span>
      </div>
      {hasCommitted && (
        <p className="mt-1 text-xs text-muted-foreground">
          + <MoneyText value={progress.committed} /> comprometido en cuotas y recurrentes ·{' '}
          {progress.isOverBudget ? (
            <span className="font-medium text-negative">
              terminarías <MoneyText value={progress.exceededBy} /> arriba
            </span>
          ) : wouldExceed ? (
            <span className="font-medium text-negative">
              te pasarías por <MoneyText value={progress.exceededBy} />
            </span>
          ) : (
            <>
              quedan <MoneyText value={progress.free} /> libres
            </>
          )}
        </p>
      )}
    </div>
  )
}
