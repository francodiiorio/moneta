import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const PERIOD_OPTIONS = [3, 6, 12]

interface PeriodSelectProps {
  value: number
  onChange: (monthsBack: number) => void
}

/** "Últimos N meses" pill used by both trend charts on the Dashboard
 *  (Progreso de tus inversiones, Evolución de gastos) — each keeps its
 *  own independent value, so this takes value/onChange rather than
 *  reading any shared store. */
export function PeriodSelect({ value, onChange }: PeriodSelectProps) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" className="rounded-full" aria-label="Elegir período">
        <SelectValue>Últimos {value} meses</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {PERIOD_OPTIONS.map((option) => (
          <SelectItem key={option} value={String(option)}>
            Últimos {option} meses
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
