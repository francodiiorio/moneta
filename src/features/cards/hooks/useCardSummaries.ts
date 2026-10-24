import { useLiveQuery } from 'dexie-react-hooks'
import { listCardSummaries } from '../service'

export function useCardSummaries() {
  return useLiveQuery(() => listCardSummaries(), [])
}
