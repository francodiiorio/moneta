import { useLiveQuery } from 'dexie-react-hooks'
import { listIncomeCategories } from '../service'

export function useIncomeCategories() {
  return useLiveQuery(() => listIncomeCategories(), [])
}
