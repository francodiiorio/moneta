import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
      <div className="mt-1 flex flex-col items-start gap-1">
        <Badge variant="secondary" className="gap-1 border-transparent">
          <Minus className="size-3" />
          0%
        </Badge>
        <p className="text-xs text-muted-foreground">Igual que {compareLabel ?? 'el mes pasado'}</p>
      </div>
    )
  }

  const isIncrease = rounded > 0
  const isGood = invert ? !isIncrease : isIncrease
  const Icon = isIncrease ? ArrowUp : ArrowDown

  return (
    <div className="mt-1 flex flex-col items-start gap-1">
      <Badge className={cn('gap-1 border-transparent', isGood ? 'bg-positive/15 text-positive' : 'bg-negative/15 text-negative')}>
        <Icon className="size-3" />
        {Math.abs(rounded)}%
      </Badge>
      <p className="text-xs text-muted-foreground">vs. {compareLabel ?? 'mes anterior'}</p>
    </div>
  )
}
