import { Pencil, Trash2 } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import type { InstallmentPlanListItem } from '../service'

interface InstallmentPlanRowProps {
  item: InstallmentPlanListItem
  onEdit: () => void
  onDelete: () => void
}

export function InstallmentPlanRow({ item, onEdit, onDelete }: InstallmentPlanRowProps) {
  const percentPaid = item.count === 0 ? 0 : (item.confirmedCount / item.count) * 100

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} />
          <div className="min-w-0">
            <p className="truncate font-medium">{item.description}</p>
            <p className="truncate text-xs text-muted-foreground">
              {item.categoryLabel} · {item.accountLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentPaid}%` }} />
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Cuota {item.confirmedCount} de {item.count}
        </span>
        <span className="font-medium">
          Quedan <MoneyText value={item.remaining} />
        </span>
      </div>
    </div>
  )
}
