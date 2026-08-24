import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { roundHalfUp } from '@/domain/money'
import { cn } from '@/lib/cn'

interface VariationBadgeProps {
  /** Percent change vs. the previous month, from `domain/money:percentChange`. */
  percent: number
  /** True when a decrease is the good outcome (e.g. Gastos) — flips the color. */
  invert?: boolean
}

export function VariationBadge({ percent, invert = false }: VariationBadgeProps) {
  // roundHalfUp, not Math.round — same reasoning as CLAUDE.md "Redondeo":
  // Math.round isn't symmetric for negatives, so a mirrored +2.5%/-2.5%
  // would otherwise round to different-looking magnitudes ("3%" vs "2%").
  const rounded = roundHalfUp(percent)

  if (rounded === 0) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" />
        Igual que el mes pasado
      </p>
    )
  }

  const isIncrease = rounded > 0
  const isGood = invert ? !isIncrease : isIncrease
  const Icon = isIncrease ? ArrowUp : ArrowDown

  return (
    <p className={cn('mt-1 flex items-center gap-1 text-xs', isGood ? 'text-positive' : 'text-negative')}>
      <Icon className="size-3" />
      {Math.abs(rounded)}% vs. mes anterior
    </p>
  )
}
