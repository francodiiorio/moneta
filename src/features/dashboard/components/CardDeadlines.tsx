import { Link } from 'react-router'
import { Check, CreditCard } from 'lucide-react'
import { MoneyTotals } from '@/components/MoneyTotals'
import { formatShortDate, relativeDays } from '@/lib/dates'
import { cn } from '@/lib/cn'
// The cards feature's hook, not its components — same cross-feature
// exception as the other Dashboard hooks.
import { useCardSummaries } from '@/features/cards/hooks/useCardSummaries'
import { Panel, PanelEmpty } from './Panel'

/** Days ahead at which a close/due date gets highlighted. */
const SOON = 3

/** "Cuándo cierra y cuánto voy a pagar": per active card, the statement
 *  accumulating now and the closed one being paid. In-app only — with no
 *  backend there's no way to push a reminder. */
export function CardDeadlines() {
  const summaries = useCardSummaries()?.filter((s) => !s.card.isArchived)

  return (
    <Panel title="Tarjetas" icon={CreditCard} to="/tarjetas">
      {summaries === undefined ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : summaries.length === 0 ? (
        <PanelEmpty text="Sabé cuándo cierra cada tarjeta y cuánto vas a pagar." to="/tarjetas" action="Agregar una tarjeta" />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {summaries.map(({ card, current, previous, daysToClose, daysToDue }) => (
            <Link key={card.id} to={`/tarjetas/${card.id}`} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{card.name}</span>
                <MoneyTotals totals={current.totals} className="text-sm font-semibold" />
              </div>
              <p className={cn('text-xs text-muted-foreground', daysToClose <= SOON && 'font-medium text-foreground')}>
                Cierra el {formatShortDate(current.closeDate)} ({relativeDays(daysToClose)})
              </p>
              {previous.due === 'paid' ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5 text-positive" />
                  Resumen anterior pagado
                </p>
              ) : previous.due === 'mismatch' ? (
                <p className="text-xs font-medium text-negative">Resumen anterior pagado con diferencia</p>
              ) : previous.due === 'pending' || previous.due === 'overdue' ? (
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span
                    className={cn(
                      'text-muted-foreground',
                      (previous.due === 'overdue' || daysToDue <= SOON) && 'font-medium text-negative',
                    )}
                  >
                    {previous.due === 'overdue'
                      ? `Venció el ${formatShortDate(previous.dueDate)} sin pagar`
                      : `Vence el ${formatShortDate(previous.dueDate)} (${relativeDays(daysToDue)})`}
                  </span>
                  <MoneyTotals totals={previous.totals} className="font-medium" />
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </Panel>
  )
}
