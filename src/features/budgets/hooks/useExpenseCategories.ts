import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo } from '@/database/repositories'

/** Active expense categories only — budgeting an income category isn't
 *  meaningful, and an archived one can't be picked for a new budget. */
export function useExpenseCategories() {
  return useLiveQuery(
    async () => (await categoriesRepo.listCategories()).filter((c) => c.kind === 'expense' && !c.isArchived),
    [],
  )
}
