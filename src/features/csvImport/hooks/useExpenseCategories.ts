import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo } from '@/database/repositories'

export function useExpenseCategories() {
  return useLiveQuery(
    async () => (await categoriesRepo.listCategories()).filter((c) => c.kind === 'expense' && !c.isArchived),
    [],
  )
}
