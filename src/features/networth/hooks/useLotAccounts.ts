import { useLiveQuery } from 'dexie-react-hooks'
import { listAccountsForLots } from '../service'

export function useLotAccounts() {
  return useLiveQuery(() => listAccountsForLots(), [])
}
