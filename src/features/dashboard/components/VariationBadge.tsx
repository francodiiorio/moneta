import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { roundHalfUp } from '@/domain/money'
import { cn } from '@/lib/cn'

interface VariationBadgeProps {
  /** Percent change vs. the comparison point, from `domain/money:percentChange`. */
  percent: number
  /** True when a decrease is the good outcome (e.g. Gastos) — flips the color. */
  invert?: boolean
  /** Overrides the default "mes anterior"/"el mes pasado" framing, for
   *  comparisons that aren't month-over-month (e.g. Dashboard's progreso
   *  de inversiones card, compared against 6 months ago). */
  compareLabel?: string
}

export function VariationBadge({ percent, invert = false, compareLabel }: VariationBadgeProps) {
  // roundHalfUp, not Math.round — same reasoning as CLAUDE.md "Redondeo":
  // Math.round isn't symmetric for negatives, so a mirrored +2.5%/-2.5%
  // would otherwise round to different-looking magnitudes ("3%" vs "2%").
  const rounded = roundHalfUp(percent)

  if (rounded === 0) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" />
        {compareLabel ? `Igual que ${compareLabel}` : 'Igual que el mes pasado'}
      </p>
    )
  }

  const isIncrease = rounded > 0
  const isGood = invert ? !isIncrease : isIncrease
  const Icon = isIncrease ? ArrowUp : ArrowDown

  return (
    <p className={cn('mt-1 flex items-center gap-1 text-xs', isGood ? 'text-positive' : 'text-negative')}>
      <Icon className="size-3" />
      {Math.abs(rounded)}% vs. {compareLabel ?? 'mes anterior'}
    </p>
  )
}
