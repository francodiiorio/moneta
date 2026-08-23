import { useLiveQuery } from 'dexie-react-hooks'
import { getInvestmentHoldingsWithDetails } from '../service'

export function useInvestmentHoldingsWithDetails() {
  return useLiveQuery(() => getInvestmentHoldingsWithDetails(), [])
}
