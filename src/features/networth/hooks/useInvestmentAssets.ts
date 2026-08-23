import { useLiveQuery } from 'dexie-react-hooks'
import { listInvestmentAssets } from '../service'

export function useInvestmentAssets() {
  return useLiveQuery(() => listInvestmentAssets(), [])
}
