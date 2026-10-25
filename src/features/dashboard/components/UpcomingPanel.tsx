import { CalendarClock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CategoryIcon } from '@/components/CategoryIcon'
import { MoneyText } from '@/components/MoneyText'
import { daysBetween, formatShortDate, relativeDays, todayStamp } from '@/lib/dates'
import { useUpcoming } from '../hooks/useUpcoming'
import { Panel, PanelEmpty } from './Panel'

export function UpcomingPanel() {
  const upcoming = useUpcoming()
  const today = todayStamp()

  return (
    <Panel title="Se viene" icon={CalendarClock} to="/planes" linkLabel="Planes">
      {upcoming === undefined ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : upcoming.length === 0 ? (
        <PanelEmpty
          text="Nada en el próximo mes. Cargá tus cuotas y gastos fijos para verlos venir."
          to="/planes"
          action="Ir a Planes"
        />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {upcoming.slice(0, 5).map((item) => (
            <div key={item.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.description}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {formatShortDate(item.date)} · {relativeDays(daysBetween(today, item.date))}
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {item.kind === 'installment' ? 'Cuota' : 'Fijo'}
                  </Badge>
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium">
                <MoneyText value={item.amount} />
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
