import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo } from '@/database/repositories'

export function useIncomeCategories() {
  return useLiveQuery(
    async () => (await categoriesRepo.listCategories()).filter((c) => c.kind === 'income' && !c.isArchived),
    [],
  )
}
