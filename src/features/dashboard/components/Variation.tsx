import { ArrowDown, ArrowUp } from 'lucide-react'
import { roundHalfUp } from '@/domain/money'
import { cn } from '@/lib/cn'

interface VariationProps {
  /** From domain/money:percentChange. */
  percent: number | undefined
  /** A decrease is the good outcome (gastos). */
  invert?: boolean
  compareLabel?: string
}

/** One-line variation for a KPI footer: "▲ 9% vs. mes anterior". */
export function Variation({ percent, invert = false, compareLabel = 'mes anterior' }: VariationProps) {
  if (percent === undefined) return <span>Sin datos del {compareLabel}</span>
  // roundHalfUp, not Math.round — symmetric for negatives (CLAUDE.md).
  const rounded = roundHalfUp(percent)
  if (rounded === 0) return <span>Igual que el {compareLabel}</span>
  const isUp = rounded > 0
  const isGood = invert ? !isUp : isUp
  const Icon = isUp ? ArrowUp : ArrowDown
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-flex items-center gap-0.5 font-medium', isGood ? 'text-positive' : 'text-negative')}>
        <Icon className="size-3" />
        {Math.abs(rounded)}%
      </span>
      vs. {compareLabel}
    </span>
  )
}
