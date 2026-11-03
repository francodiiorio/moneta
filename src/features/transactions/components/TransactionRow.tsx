import { ArrowDownLeft, MoreVertical, Receipt } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CategoryIcon } from '@/components/CategoryIcon'
import { formatShortDate } from '@/lib/dates'
import type { TransactionListItem } from '../service'

interface TransactionRowProps {
  item: TransactionListItem
  onEdit: () => void
  onDelete: () => void
}

export function TransactionRow({ item, onEdit, onDelete }: TransactionRowProps) {
  const hasCategoryIdentity = item.categoryColor !== undefined || item.categoryIcon !== undefined

  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      {hasCategoryIdentity ? (
        <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} />
      ) : item.kind === 'income' ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-positive/10 text-positive">
          <ArrowDownLeft className="size-4.5" />
        </div>
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-negative/10 text-negative">
          <Receipt className="size-4.5" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.description}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[item.categoryLabel ?? '—', item.paymentLabel].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold">
          <MoneyText value={item.amount} signColor />
        </p>
        {/* Next to the date, not the name: on a phone the name needs the
            whole width. */}
        <div className="flex items-center justify-end gap-1.5">
          {item.status === 'projected' && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
              Por pagar
            </Badge>
          )}
          <p className="text-xs text-muted-foreground">{formatShortDate(item.date)}</p>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label="Más opciones">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
