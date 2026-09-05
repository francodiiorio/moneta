import { Calendar } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currentMonthStamp, formatMonthLabel, shiftMonth, type MonthStamp } from '@/lib/dates'
import { useDashboardUiStore } from '../store'

const MONTHS_BACK = 12

export function MonthSelector() {
  const month = useDashboardUiStore((s) => s.month)
  const setMonth = useDashboardUiStore((s) => s.setMonth)

  const current = currentMonthStamp()
  const options: MonthStamp[] = Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonth(current, -i))

  return (
    <Select value={month} onValueChange={setMonth}>
      <SelectTrigger className="rounded-full" aria-label="Elegir mes">
        <Calendar className="size-4 text-muted-foreground" />
        <SelectValue>{formatMonthLabel(month)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {formatMonthLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
