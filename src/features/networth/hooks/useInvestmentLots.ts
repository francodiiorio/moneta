import { useLiveQuery } from 'dexie-react-hooks'
import { listInvestmentLots } from '../service'

export function useInvestmentLots(assetId: string | undefined) {
  return useLiveQuery(() => (assetId ? listInvestmentLots(assetId) : Promise.resolve([])), [assetId])
}
