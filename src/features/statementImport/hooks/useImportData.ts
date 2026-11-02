import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo, creditCardsRepo } from '@/database/repositories'

export function useExpenseCategories() {
  return useLiveQuery(() => categoriesRepo.listActiveCategories('expense'), [])
}

export function useCards() {
  return useLiveQuery(async () => (await creditCardsRepo.listCreditCards()).filter((c) => !c.isArchived), [])
}
