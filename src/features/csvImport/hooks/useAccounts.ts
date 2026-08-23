import { useLiveQuery } from 'dexie-react-hooks'
import { listAccountsWithBalances } from '@/database/repositories/accounts.repo'

export function useAccounts() {
  return useLiveQuery(() => listAccountsWithBalances(), [])
}
