import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, type LucideIcon } from 'lucide-react'
import type { RecurringPlanListItem } from './service'

export const RECURRING_KIND_ICONS: Record<RecurringPlanListItem['kind'], LucideIcon> = {
  expense: ArrowDownCircle,
  income: ArrowUpCircle,
  transfer: ArrowLeftRight,
  adjustment: ArrowLeftRight,
  // Unreachable in practice — a recurring plan can never generate a
  // 'investment' transaction (buildTemplateEntry rejects it), same as
  // 'adjustment'. Only here to satisfy the exhaustive Record.
  investment: ArrowLeftRight,
}
