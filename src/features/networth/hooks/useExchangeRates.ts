import { useLiveQuery } from 'dexie-react-hooks'
import { listExchangeRates } from '../service'

export function useExchangeRates() {
  return useLiveQuery(() => listExchangeRates(), [])
}
