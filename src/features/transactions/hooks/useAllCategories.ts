import { useLiveQuery } from 'dexie-react-hooks'
import { listAllCategories } from '../service'

export function useAllCategories() {
  return useLiveQuery(() => listAllCategories(), [])
}
