import { useLiveQuery } from 'dexie-react-hooks'
import { listExpenseCategories } from '../service'

export function useExpenseCategories() {
  return useLiveQuery(() => listExpenseCategories(), [])
}
