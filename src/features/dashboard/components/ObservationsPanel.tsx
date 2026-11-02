import { Lightbulb, TrendingDown, TrendingUp } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { formatMonthLabel, shiftMonth, type MonthStamp } from '@/lib/dates'
import { useMonthObservations } from '../hooks/useMonthObservations'
import { Panel } from './Panel'

const percentFormat = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 0 })

/** "octubre". */
const monthName = (month: MonthStamp) => formatMonthLabel(month).toLowerCase().replace(/ \d{4}$/, '')

/** Up to three changes against last month, one sentence each. Nothing to
 *  say, nothing shown: it's a hint, not a section to fill. */
export function ObservationsPanel({ month }: { month: MonthStamp }) {
  const observations = useMonthObservations(month)
  if (!observations || observations.items.length === 0) return null

  const previous = monthName(shiftMonth(month, -1))
  return (
    <Panel title="Lo que cambió" icon={Lightbulb}>
      <p className="mb-2.5 text-xs text-muted-foreground">Lo que compraste contra {previous}, sin contar los gastos fijos.</p>
      <ul className="flex flex-col gap-2.5">
        {observations.items.map((item) => {
          const Icon = item.percent > 0 ? TrendingUp : TrendingDown
          // Something was spent in both periods: −99.6% isn't "100% menos".
          const shown = item.percent > 0 ? item.percent : Math.min(-item.percent, 99)
          const change = `${percentFormat.format(shown / 100)} ${item.percent > 0 ? 'más' : 'menos'}`
          return (
            <li key={item.key} className="flex items-start gap-2 text-sm">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="min-w-0">
                En {item.kind === 'category' && 'la categoría '}
                <span className="font-medium">{item.label}</span>{' '}
                {observations.toDate ? (
                  <>
                    llevás <MoneyText value={item.current} />, {change} que a esta altura de {previous}.
                  </>
                ) : (
                  <>
                    gastaste <MoneyText value={item.current} /> en {monthName(month)}, {change} que en {previous}.
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
