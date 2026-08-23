import type { InvestmentAsset } from '@/domain/entities'

export const INVESTMENT_ASSET_TYPE_LABELS: Record<InvestmentAsset['type'], string> = {
  etf: 'ETF',
  stock: 'Acción',
  cedear: 'CEDEAR',
  bond: 'Bono',
  fund: 'FCI',
  crypto: 'Cripto',
  other: 'Otro',
}
