import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/cn'

const TONES = {
  primary: 'bg-primary/10 text-primary',
  positive: 'bg-positive/10 text-positive',
  negative: 'bg-negative/10 text-negative',
} as const

interface KpiCardProps {
  label: ReactNode
  icon: LucideIcon
  tone?: keyof typeof TONES
  /** The figure — a MoneyText, or a placeholder while loading. */
  value: ReactNode
  /** Context under the figure: a variation, a rate. */
  footer?: ReactNode
}

export function KpiCard({ label, icon: Icon, tone = 'primary', value, footer }: KpiCardProps) {
  return (
    <Card className="gap-0 py-4">
      <div className="flex items-start justify-between gap-2 px-4">
        <div className="flex h-6 items-center gap-1 text-xs text-muted-foreground">{label}</div>
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', TONES[tone])}>
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-1 px-4 text-xl font-semibold sm:text-2xl">{value}</div>
      {footer && <div className="mt-1 px-4 text-xs text-muted-foreground">{footer}</div>}
    </Card>
  )
}
