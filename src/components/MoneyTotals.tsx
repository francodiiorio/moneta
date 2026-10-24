import { MoneyText } from '@/components/MoneyText'
import type { Money } from '@/domain/money'
import { cn } from '@/lib/cn'

interface MoneyTotalsProps {
  totals: Money[]
  className?: string
}

/** A total that spans currencies — one amount per currency ("$ 40.000,00
 *  + USD 10.00"), never converted into one (e.g. a card statement). Shared
 *  by Tarjetas and the Dashboard. "—" when there's nothing. */
export function MoneyTotals({ totals, className }: MoneyTotalsProps) {
  if (totals.length === 0) return <span className={cn('text-muted-foreground', className)}>—</span>
  return (
    <span className={cn('flex flex-wrap items-baseline gap-x-1.5', className)}>
      {totals.map((total, index) => (
        <span key={total.currency} className="flex items-baseline gap-1.5">
          {index > 0 && <span className="text-muted-foreground">+</span>}
          <MoneyText value={total} />
        </span>
      ))}
    </span>
  )
}
