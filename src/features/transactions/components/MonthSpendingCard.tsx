import { MoneyText } from '@/components/MoneyText'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatMonthLabel, type MonthStamp } from '@/lib/dates'
import { useMonthSpending } from '../hooks/useTransactions'
import { useTransactionsUiStore } from '../store'

interface MonthSpendingCardProps {
  month: MonthStamp
  /** The category the list is filtered by, if any — named in the title. */
  categoryName?: string
}

/** How much the gastos listed below add up to — so the total always
 *  matches the list, filters included. */
export function MonthSpendingCard({ month, categoryName }: MonthSpendingCardProps) {
  const spending = useMonthSpending()
  const hideCuotas = useTransactionsUiStore((s) => s.hideCuotas)
  const setHideCuotas = useTransactionsUiStore((s) => s.setHideCuotas)
  const monthName = formatMonthLabel(month).toLowerCase().replace(/ \d{4}$/, '')

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          Gastado en {monthName}
          {categoryName !== undefined && ` · ${categoryName}`}
          {hideCuotas && ' · sin cuotas'}
        </p>
        {spending === undefined ? (
          <div className="mt-1 h-8 w-36 animate-pulse rounded-md bg-muted" />
        ) : (
          <>
            <p className="mt-0.5 text-2xl font-semibold">
              <MoneyText value={spending.spent} />
            </p>
            {spending.pending.amount > 0 && (
              <p className="text-xs text-muted-foreground">
                + <MoneyText value={spending.pending} /> por pagar
              </p>
            )}
            {spending.missingRateCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Sin contar {spending.missingRateCount === 1 ? '1 gasto' : `${spending.missingRateCount} gastos`} en otra moneda
                sin tasa de cambio.
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <Switch id="hide-cuotas" checked={hideCuotas} onCheckedChange={setHideCuotas} />
        <Label htmlFor="hide-cuotas" className="text-sm font-normal">
          Ocultar cuotas
        </Label>
      </div>
    </div>
  )
}
