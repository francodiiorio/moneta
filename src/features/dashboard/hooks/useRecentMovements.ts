import { useLiveQuery } from 'dexie-react-hooks'
import { getRecentMovements } from '../service'

export function useRecentMovements() {
  return useLiveQuery(() => getRecentMovements(), [])
}
