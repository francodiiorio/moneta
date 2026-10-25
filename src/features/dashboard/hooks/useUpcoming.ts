import { useLiveQuery } from 'dexie-react-hooks'
import { getUpcoming } from '../service'

export function useUpcoming() {
  return useLiveQuery(() => getUpcoming(), [])
}
