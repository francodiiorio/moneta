import { Pencil, Trash2 } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import { cn } from '@/lib/cn'
import { BUDGET_NEAR_LIMIT_PERCENT, type BudgetProgressItem } from '../service'

/** Cuotas and recurring gastos still to come — the chart palette's amber,
 *  constant across themes, so it never blends with a theme's primary. */
const PENDING_COLOR = 'bg-[var(--chart-4)]'

interface BudgetProgressRowProps {
  item: BudgetProgressItem
  onEdit: () => void
  onDelete: () => void
}

export function BudgetProgressRow({ item, onEdit, onDelete }: BudgetProgressRowProps) {
  const { progress } = item
  const spentWidth = Math.min(100, Math.max(0, progress.percentUsed))
  // What's still to pay (cuotas, recurring gastos) follows what's spent,
  // in its own color.
  const pendingWidth = Math.min(100 - spentWidth, Math.max(0, progress.percentCommitted))
  const hasPending = progress.committed.amount > 0
  const isNearLimit = !progress.isOverBudget && progress.percentUsed >= BUDGET_NEAR_LIMIT_PERCENT
  const spentColor = progress.isOverBudget ? 'bg-negative' : isNearLimit ? 'bg-negative/60' : 'bg-primary'

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
        <div className={cn('h-full transition-all', spentColor)} style={{ width: `${spentWidth}%` }} />
        {pendingWidth > 0 && <div className={cn('h-full transition-all', PENDING_COLOR)} style={{ width: `${pendingWidth}%` }} />}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2">
        {progress.free.amount >= 0 ? (
          <p className="text-sm font-medium">
            <MoneyText value={progress.free} /> libres
          </p>
        ) : (
          <p className="text-sm font-medium text-negative">
            {hasPending ? 'Te pasarías por' : 'Te pasaste por'} <MoneyText value={progress.exceededBy} />
          </p>
        )}
        <p className="shrink-0 text-xs text-muted-foreground">
          de <MoneyText value={progress.budget} />
        </p>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', spentColor)} aria-hidden />
          Gastado <MoneyText value={progress.actual} />
        </span>
        {hasPending && (
          <span className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', PENDING_COLOR)} aria-hidden />
            Por pagar <MoneyText value={progress.committed} />
          </span>
        )}
      </div>
    </div>
  )
}
