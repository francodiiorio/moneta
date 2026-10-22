import type { AccountType } from '@/domain/entities'

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  wallet: 'Billetera virtual',
  broker: 'Broker',
  other: 'Otra',
}
