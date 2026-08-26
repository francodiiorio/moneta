import { Trash2 } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import { cn } from '@/lib/cn'
import type { BudgetProgressItem } from '../service'

interface BudgetProgressRowProps {
  item: BudgetProgressItem
  onDelete: () => void
}

export function BudgetProgressRow({ item, onDelete }: BudgetProgressRowProps) {
  const { progress } = item
  const barWidth = Math.min(100, Math.max(0, progress.percentUsed))
  const isNearLimit = !progress.isOverBudget && progress.percentUsed >= 90

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size="sm" />
          <p className="truncate font-medium">{item.categoryName}</p>
          <Badge variant="secondary">{item.period === 'monthly' ? 'Mensual' : 'Anual'}</Badge>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            progress.isOverBudget ? 'bg-negative' : isNearLimit ? 'bg-negative/60' : 'bg-primary',
          )}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          <MoneyText value={progress.actual} /> de <MoneyText value={progress.budget} />
        </span>
        <span className={cn('font-medium', progress.isOverBudget && 'text-negative')}>
          {Math.round(progress.percentUsed)}%
        </span>
      </div>
    </div>
  )
}
