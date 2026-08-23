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

/** The known dolarapi.com referencias, in a sensible display order —
 *  same values as dolarApi.ts's CASA_TO_PROFILE targets. A rate can
 *  still carry any other free-text `profile`, this is just what the UI
 *  offers as quick picks. */
export const RATE_PROFILE_LABELS: Record<string, string> = {
  oficial: 'Oficial',
  blue: 'Blue',
  mep: 'MEP',
  ccl: 'CCL',
  cripto: 'Cripto',
  mayorista: 'Mayorista',
  tarjeta: 'Tarjeta',
}
