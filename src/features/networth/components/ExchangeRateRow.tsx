import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ExchangeRate } from '@/domain/entities'
import { formatRelativeTime } from '@/lib/dates'
import { RATE_PROFILE_LABELS } from '../labels'

interface ExchangeRateRowProps {
  item: ExchangeRate
  onDelete: () => void
}

export function ExchangeRateRow({ item, onDelete }: ExchangeRateRowProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <p className="w-24 shrink-0 text-sm text-muted-foreground">{item.date}</p>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {item.from} → {item.to}:{' '}
          <span className="font-medium">{item.rate.toLocaleString('es-AR', { maximumFractionDigits: 4 })}</span>
          {item.profile && (
            <Badge variant="secondary" className="ml-2">
              {RATE_PROFILE_LABELS[item.profile] ?? item.profile}
            </Badge>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {item.source === 'automatic' ? 'Automática' : 'Manual'}
          {item.capturedAt && ` · ${formatRelativeTime(item.capturedAt)}`}
        </p>
      </div>
      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onDelete}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
