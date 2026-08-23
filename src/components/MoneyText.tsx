import { formatMoney, isNegative, isPositive, type Money } from '@/domain/money'
import { cn } from '@/lib/cn'

interface MoneyTextProps {
  value: Money
  className?: string
  /** Colors positive/negative amounts using the semantic tokens instead
   *  of the default foreground color. Off by default — most amounts in
   *  a list (e.g. account balances) shouldn't shout. */
  signColor?: boolean
}

/** The only place in the UI that formats a Money value for display. */
export function MoneyText({ value, className, signColor = false }: MoneyTextProps) {
  return (
    <span
      className={cn(
        'tabular-nums',
        signColor && isPositive(value) && 'text-positive',
        signColor && isNegative(value) && 'text-negative',
        className,
      )}
    >
      {formatMoney(value)}
    </span>
  )
}
