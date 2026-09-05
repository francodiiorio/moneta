import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo } from '@/database/repositories'

/** Active categories only — an archived one can't be picked for a new
 *  budget. */
export function useExpenseCategories() {
  return useLiveQuery(() => categoriesRepo.listActiveCategories(), [])
}
