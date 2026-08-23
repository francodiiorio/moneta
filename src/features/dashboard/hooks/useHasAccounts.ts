import { useLiveQuery } from 'dexie-react-hooks'
import { accountsRepo } from '@/database/repositories'

/** Whether the user has created at least one account — used to decide
 *  between showing the summary and the first-run empty state. */
export function useHasAccounts(): boolean | undefined {
  const accounts = useLiveQuery(() => accountsRepo.listAccountsWithBalances(), [])
  return accounts === undefined ? undefined : accounts.length > 0
}
