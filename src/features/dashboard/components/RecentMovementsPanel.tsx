import { ArrowLeftRight } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { MoneyText } from '@/components/MoneyText'
import { formatShortDate } from '@/lib/dates'
import { useRecentMovements } from '../hooks/useRecentMovements'
import { Panel, PanelEmpty } from './Panel'

export function RecentMovementsPanel() {
  const movements = useRecentMovements()

  return (
    <Panel title="Últimos movimientos" icon={ArrowLeftRight} to="/movimientos">
      {movements === undefined ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : movements.length === 0 ? (
        <PanelEmpty text="Todavía no hay movimientos en estos dos meses." to="/movimientos" action="Cargar un movimiento" />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {movements.map((item) => (
            <div key={`${item.kind}:${item.id}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.description}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatShortDate(item.date)} · {[item.categoryLabel, item.accountLabel].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium">
                <MoneyText value={item.amount} signColor={item.signed} />
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
