import { Pencil, Trash2 } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { money } from '@/domain/money'
import type { SavingsHolding } from '@/domain/entities'

interface SavingsRowProps {
  item: SavingsHolding
  onEdit: () => void
  onDelete: () => void
}

export function SavingsRow({ item, onEdit, onDelete }: SavingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-4">
      <div className="min-w-0">
        <p className="truncate font-medium">{item.name}</p>
        {(item.location || item.notes) && (
          <p className="truncate text-xs text-muted-foreground">
            {[item.location, item.notes].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <MoneyText value={money(item.amount, item.currency)} className="font-medium" />
        <Button variant="ghost" size="icon" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
