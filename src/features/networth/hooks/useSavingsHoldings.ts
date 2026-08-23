import { useLiveQuery } from 'dexie-react-hooks'
import { listSavingsHoldings } from '../service'

export function useSavingsHoldings() {
  return useLiveQuery(() => listSavingsHoldings(), [])
}
