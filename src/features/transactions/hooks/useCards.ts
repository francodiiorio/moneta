import { useLiveQuery } from 'dexie-react-hooks'
import { listAllCards } from '../service'

export function useCards() {
  return useLiveQuery(() => listAllCards(), [])
}
