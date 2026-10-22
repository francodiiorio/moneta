import { useLiveQuery } from 'dexie-react-hooks'
import type { CategoryKind } from '@/domain/entities'
import { listCategories } from '../service'

export function useCategories(kind: CategoryKind) {
  return useLiveQuery(() => listCategories(kind), [kind])
}
