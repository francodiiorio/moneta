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
import { CategoryIcon } from '@/components/CategoryIcon'
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
  // Ni una transferencia ni una compra de inversión son gasto/ingreso: no
  // hay plata que se gane ni se pierda, sólo cambia de lugar — mismo
  // trato visual neutro para las dos (sin color de fondo, monto sin
  // color de signo).
  const isNeutralKind = isTransfer || item.kind === 'investment'
  // A transfer has no category to draw identity from; an expense/income
  // without a customized icon/color keeps the plain kind-colored badge
  // instead of falling back to CategoryIcon's neutral tag — no visual
  // change for anyone who hasn't set one up.
  const hasCategoryIdentity = !isNeutralKind && (item.categoryColor !== undefined || item.categoryIcon !== undefined)

  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      {hasCategoryIdentity ? (
        <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} />
      ) : (
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full',
            item.kind === 'expense' && 'bg-negative/10 text-negative',
            item.kind === 'income' && 'bg-positive/10 text-positive',
            isNeutralKind && 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-4.5" />
        </div>
      )}

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
          <MoneyText value={item.amount} signColor={!isNeutralKind} />
        </p>
        <p className="text-xs text-muted-foreground">{formatShortDate(item.date)}</p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label="Más opciones">
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
