import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, type LucideIcon } from 'lucide-react'
import type { RecurringPlanListItem } from './service'

export const RECURRING_KIND_ICONS: Record<RecurringPlanListItem['kind'], LucideIcon> = {
  expense: ArrowDownCircle,
  income: ArrowUpCircle,
  transfer: ArrowLeftRight,
  adjustment: ArrowLeftRight,
}
