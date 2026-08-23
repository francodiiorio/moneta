import { useLiveQuery } from 'dexie-react-hooks'
import { getNetWorthSummary } from '../service'

export function useNetWorthSummary() {
  return useLiveQuery(() => getNetWorthSummary(), [])
}
