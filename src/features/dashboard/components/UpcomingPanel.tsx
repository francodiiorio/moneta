import { useState } from 'react'
import { CalendarClock, CalendarPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import { MoneyText } from '@/components/MoneyText'
import { daysBetween, formatShortDate, relativeDays, todayStamp } from '@/lib/dates'
import { useUpcoming } from '../hooks/useUpcoming'
import { CalendarExportDialog } from './CalendarExportDialog'
import { Panel, PanelEmpty } from './Panel'

export function UpcomingPanel() {
  const upcoming = useUpcoming()
  const today = todayStamp()
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <Panel title="Se viene" icon={CalendarClock} to="/presupuestos?tab=fijos" linkLabel="Fijos">
      {upcoming === undefined ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : upcoming.length === 0 ? (
        <PanelEmpty
          text="Nada en el próximo mes. Cargá tus cuotas y gastos fijos para verlos venir."
          to="/presupuestos?tab=fijos"
          action="Cargar un gasto fijo"
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
                    {item.kind === 'installment' ? 'Cuota' : item.kind === 'income' ? 'Ingreso' : 'Fijo'}
                  </Badge>
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium">
                <MoneyText value={item.amount} signColor={item.kind === 'income'} />
              </span>
            </div>
          ))}
        </div>
      )}
      {upcoming !== undefined && (
        <Button variant="ghost" size="sm" className="mt-2 px-0 text-primary hover:bg-transparent" onClick={() => setExportOpen(true)}>
          <CalendarPlus className="size-4" />
          Agregar al calendario
        </Button>
      )}
      <CalendarExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </Panel>
  )
}
