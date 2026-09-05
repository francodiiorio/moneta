import { useLiveQuery } from 'dexie-react-hooks'
import { listCategories } from '../service'

export function useCategories() {
  return useLiveQuery(() => listCategories(), [])
}
