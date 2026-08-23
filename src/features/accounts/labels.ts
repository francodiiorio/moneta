import type { Account } from '@/domain/entities'

export const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
  cash: 'Efectivo',
  bank: 'Banco',
  card: 'Tarjeta',
  investment: 'Inversión',
  loan: 'Préstamo',
  other: 'Otra',
}
