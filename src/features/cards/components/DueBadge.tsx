import { Badge } from '@/components/ui/badge'
import type { DueState } from '../service'

const DUE_BADGE: Record<DueState, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } | null> = {
  empty: null,
  paid: { label: 'Pagado', variant: 'outline' },
  mismatch: { label: 'Pagado con diferencia', variant: 'destructive' },
  pending: { label: 'Sin pagar', variant: 'secondary' },
  overdue: { label: 'Venció sin pagar', variant: 'destructive' },
  unrecorded: { label: 'Sin pago registrado', variant: 'secondary' },
}

export function DueBadge({ due }: { due: DueState }) {
  const badge = DUE_BADGE[due]
  return badge && <Badge variant={badge.variant}>{badge.label}</Badge>
}
