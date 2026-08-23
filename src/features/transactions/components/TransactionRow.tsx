import { MoreVertical } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/cn'
import { formatShortDate } from '@/lib/dates'
import { TRANSACTION_KIND_ICONS } from '../labels'
import type { TransactionListItem } from '../service'

interface TransactionRowProps {
  item: TransactionListItem
  /** Omit to hide "Editar" — e.g. for a kind this UI has no edit form for. */
  onEdit?: () => void
  onDelete: () => void
}

export function TransactionRow({ item, onEdit, onDelete }: TransactionRowProps) {
  const Icon = TRANSACTION_KIND_ICONS[item.kind]
  const isTransfer = item.kind === 'transfer'

  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          item.kind === 'expense' && 'bg-negative/10 text-negative',
          item.kind === 'income' && 'bg-positive/10 text-positive',
          isTransfer && 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{item.description}</p>
          {item.status === 'projected' && (
            <Badge variant="secondary" className="shrink-0">
              Proyectado
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {item.categoryLabel ? `${item.categoryLabel} · ` : ''}
          {item.accountLabel}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold">
          <MoneyText value={item.amount} signColor={!isTransfer} />
        </p>
        <p className="text-xs text-muted-foreground">{formatShortDate(item.date)}</p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEdit && <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>}
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
