import { useLiveQuery } from 'dexie-react-hooks'
import { listAccountsWithBalances } from '../service'

export function useAccountsWithBalances() {
  return useLiveQuery(() => listAccountsWithBalances(), [])
}
