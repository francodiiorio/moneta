import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo } from '@/database/repositories'

export function useExpenseCategories() {
  return useLiveQuery(() => categoriesRepo.listActiveCategories(), [])
}
