import { useState } from 'react'
import { PartyPopper } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MoneyTotals } from '@/components/MoneyTotals'
import { formatMonthLabel, formatMonthShort, shiftMonth, type MonthStamp } from '@/lib/dates'
import type { CuotaTimelineView } from '../service'

interface CuotaTimelineProps {
  timeline: CuotaTimelineView | undefined
}

/** Months shown before "Ver los N meses" — a 36-cuota loan would push the
 *  purchases off the screen. */
const FOLDED = 6

/** "febrero de 2027". */
function monthPhrase(month: MonthStamp): string {
  return formatMonthLabel(month).toLowerCase().replace(/ (\d{4})$/, ' de $1')
}

/** "Libre de cuotas": when the last cuota is paid, and what each month
 *  until then takes — one bar per month, the purchases ending under it. */
export function CuotaTimeline({ timeline }: CuotaTimelineProps) {
  const [expanded, setExpanded] = useState(false)
  if (timeline === undefined) return <div className="h-40 animate-pulse rounded-xl bg-muted" />

  const { from: thisMonth, months, freeFrom } = timeline
  if (freeFrom === undefined) {
    return (
      <Card className="flex-row items-center gap-2 px-5 py-4 font-medium">
        <PartyPopper className="size-5 text-primary" />
        No te quedan cuotas por pagar.
      </Card>
    )
  }

  const first = months[0]
  const paysThisMonth = first?.month === thisMonth && first.totals.length > 0
  const lastThisMonth = freeFrom === shiftMonth(thisMonth, 1)
  const visible = expanded ? months : months.slice(0, FOLDED)

  return (
    <Card className="gap-4 px-5 py-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PartyPopper className="size-5 shrink-0 text-primary" />
          {lastThisMonth ? 'Este mes pagás tu última cuota' : `Libre de cuotas en ${monthPhrase(freeFrom)}`}
        </h2>
        {paysThisMonth && (
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
            {lastThisMonth ? 'Son' : 'Este mes pagás'}{' '}
            <MoneyTotals totals={first.totals} className="font-medium text-foreground" /> en cuotas.
          </p>
        )}
      </div>

      {/* role="list": Safari drops the list semantics of a list-style:none <ol>. */}
      <ol role="list" aria-label="Cuotas por mes" className="flex flex-col gap-3">
        {visible.map(({ month, totals, share, ending }, index) => (
          <li key={month} className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-muted-foreground">
                <span aria-hidden="true">
                  {formatMonthShort(month)}
                  {(index === 0 || month.endsWith('-01')) && ` ${month.slice(0, 4)}`}
                </span>
                <span className="sr-only">{formatMonthLabel(month)}</span>
              </span>
              {totals.length > 0 ? (
                <MoneyTotals totals={totals} className="font-medium" />
              ) : (
                <span className="text-muted-foreground">Sin cuotas</span>
              )}
            </div>
            {/* Its own full-width line: every bar measures against the same width. */}
            <div className="h-1.5 w-full" aria-hidden="true">
              {share > 0 && <div className="h-full min-w-1 rounded-full bg-primary" style={{ width: `${share * 100}%` }} />}
            </div>
            {ending.length > 0 && <p className="text-xs text-muted-foreground">Última de {ending.join(', ')}</p>}
          </li>
        ))}
      </ol>
      {months.length > FOLDED && (
        <Button variant="ghost" size="sm" className="self-start px-0 text-primary hover:bg-transparent" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Ver menos' : `Ver los ${months.length} meses`}
        </Button>
      )}
    </Card>
  )
}
