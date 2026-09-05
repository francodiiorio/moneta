import { Pause, Pencil, Play, Receipt, Trash2 } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import { cn } from '@/lib/cn'
import { formatShortDate } from '@/lib/dates'
import type { RecurringPlanListItem } from '../service'

interface RecurringPlanRowProps {
  item: RecurringPlanListItem
  onEdit: () => void
  onTogglePaused: () => void
  onDelete: () => void
}

export function RecurringPlanRow({ item, onEdit, onTogglePaused, onDelete }: RecurringPlanRowProps) {
  const hasCategoryIdentity = item.categoryColor !== undefined || item.categoryIcon !== undefined

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-border p-4', item.isPaused && 'opacity-60')}>
      {hasCategoryIdentity ? (
        <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-negative/10 text-negative">
          <Receipt className="size-4.5" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{item.description}</p>
          {item.isPaused && <Badge variant="secondary">Pausado</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {item.ruleDescription}
          {item.nextOccurrence && ` · Próxima: ${formatShortDate(item.nextOccurrence)}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">{item.categoryLabel}</p>
      </div>

      <p className="shrink-0 text-sm font-semibold">
        <MoneyText value={item.amount} />
      </p>

      <Button variant="ghost" size="icon" className="shrink-0" onClick={onEdit}>
        <Pencil className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="shrink-0" onClick={onTogglePaused}>
        {item.isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </Button>
      <Button variant="ghost" size="icon" className="shrink-0" onClick={onDelete}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
