import { useLiveQuery } from 'dexie-react-hooks'
import type { Category } from '@/domain/entities'
import { listCategoriesByKind } from '../service'

export function useCategories(kind: Category['kind']) {
  return useLiveQuery(() => listCategoriesByKind(kind), [kind])
}
