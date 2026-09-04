import { useLiveQuery } from 'dexie-react-hooks'
import { listAccountsWithBalances } from '../service'

export function useAccounts() {
  return useLiveQuery(() => listAccountsWithBalances(), [])
}
