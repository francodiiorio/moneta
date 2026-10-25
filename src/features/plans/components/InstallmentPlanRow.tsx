import { Pencil, Trash2 } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import { formatMonthLabel } from '@/lib/dates'
import type { InstallmentPlanListItem } from '../service'

interface InstallmentPlanRowProps {
  item: InstallmentPlanListItem
  onEdit: () => void
  onDelete: () => void
}

/** With a card, the bank's count: the cuota in the statement open today,
 *  and what's left to be billed. Without one, by each cuota's date. */
function progressText(item: InstallmentPlanListItem): { label: string; done: number; remaining: string | null } {
  const progress = item.cardProgress
  if (!progress) return { label: `Cuota ${item.confirmedCount} de ${item.count}`, done: item.confirmedCount, remaining: null }
  const month = (period: string) => formatMonthLabel(period).toLowerCase()
  const { stage } = progress
  const label =
    stage.kind === 'finished'
      ? 'Terminada'
      : stage.kind === 'upcoming'
        ? `Cuota ${stage.number} de ${item.count} · entra en el resumen de ${month(stage.firstPeriod)}`
        : stage.inOpenStatement
          ? `Cuota ${stage.number} de ${item.count} · en el resumen en curso`
          : `Cuota ${stage.number} de ${item.count} · en el resumen de ${month(stage.period)}`
  const remaining =
    progress.unbilledCount === 0
      ? null
      : `${progress.unbilledCount} cuota${progress.unbilledCount === 1 ? '' : 's'}`
  return { label, done: progress.billedCount, remaining }
}

export function InstallmentPlanRow({ item, onEdit, onDelete }: InstallmentPlanRowProps) {
  const progress = progressText(item)
  const percentPaid = item.count === 0 ? 0 : (progress.done / item.count) * 100
  // With a card, what's left is what hasn't reached a statement yet.
  const remaining = item.cardProgress ? item.cardProgress.unbilled : item.remaining

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} />
          <div className="min-w-0">
            <p className="truncate font-medium">{item.description}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[item.categoryLabel, item.paymentLabel].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentPaid}%` }} />
      </div>

      <div className="mt-2 flex items-start justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{progress.label}</span>
        <span className="shrink-0 text-right">
          {/* With a card it's what hasn't reached a statement yet — not the
              same as "quedan" by date, so it says so. */}
          <span className="block font-medium">
            {item.cardProgress ? 'Por facturar' : 'Quedan'} <MoneyText value={remaining} />
          </span>
          {progress.remaining && <span className="block text-xs text-muted-foreground">{progress.remaining}</span>}
        </span>
      </div>
    </div>
  )
}
