import { Link } from 'react-router'
import { Check, CreditCard } from 'lucide-react'
import { MoneyTotals } from '@/components/MoneyTotals'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatShortDate, relativeDays } from '@/lib/dates'
import { cn } from '@/lib/cn'
// The cards feature's hook, not its components — same cross-feature
// exception as the other Dashboard hooks.
import { useCardSummaries } from '@/features/cards/hooks/useCardSummaries'

/** Days ahead at which a close/due date gets highlighted. */
const SOON = 3

/** "Cuándo cierra y cuánto voy a pagar": per active card, the statement
 *  accumulating now and the closed one being paid. Hidden without cards.
 *  In-app only — with no backend there's no way to push a reminder. */
export function CardDeadlines() {
  const summaries = useCardSummaries()?.filter((s) => !s.card.isArchived)
  if (!summaries || summaries.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4" />
          Tarjetas
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {summaries.map(({ card, current, previous, daysToClose, daysToDue }) => (
          <Link
            key={card.id}
            to={`/tarjetas/${card.id}`}
            className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,10rem)_1fr_1fr] sm:items-center"
          >
            <span className="truncate font-medium">{card.name}</span>
            <span className="text-sm">
              <span className={cn('block text-xs text-muted-foreground', daysToClose <= SOON && 'font-medium text-foreground')}>
                Cierra el {formatShortDate(current.closeDate)} ({relativeDays(daysToClose)})
              </span>
              <MoneyTotals totals={current.totals} />
            </span>
            {previous.due === 'empty' ? (
              <span className="text-xs text-muted-foreground">Nada por pagar del resumen anterior</span>
            ) : previous.due === 'paid' ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5" />
                Resumen anterior pagado
              </span>
            ) : previous.due === 'mismatch' ? (
              <span className="text-xs font-medium text-negative">Resumen anterior pagado con diferencia</span>
            ) : (
              <span className="text-sm">
                <span
                  className={cn(
                    'block text-xs text-muted-foreground',
                    (previous.due === 'overdue' || daysToDue <= SOON) && 'font-medium text-negative',
                  )}
                >
                  {previous.due === 'overdue'
                    ? `Venció el ${formatShortDate(previous.dueDate)} sin pagar`
                    : `Vence el ${formatShortDate(previous.dueDate)} (${relativeDays(daysToDue)})`}
                </span>
                <MoneyTotals totals={previous.totals} />
              </span>
            )}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
