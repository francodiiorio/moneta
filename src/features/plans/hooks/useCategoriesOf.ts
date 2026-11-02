import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo } from '@/database/repositories'
import type { CategoryKind } from '@/domain/entities'

export function useCategoriesOf(kind: CategoryKind) {
  return useLiveQuery(() => categoriesRepo.listActiveCategories(kind), [kind])
}
