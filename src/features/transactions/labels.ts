import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, TrendingUp, type LucideIcon } from 'lucide-react'
import type { Transaction } from '@/domain/entities'

export const TRANSACTION_KIND_LABELS: Record<Transaction['kind'], string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Transferencia',
  adjustment: 'Ajuste',
  investment: 'Compra de inversión',
}

export const TRANSACTION_KIND_ICONS: Record<Transaction['kind'], LucideIcon> = {
  expense: ArrowDownCircle,
  income: ArrowUpCircle,
  transfer: ArrowLeftRight,
  adjustment: ArrowLeftRight,
  investment: TrendingUp,
}
