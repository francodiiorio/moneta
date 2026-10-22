import { useLiveQuery } from 'dexie-react-hooks'
import { listAllAccounts } from '../service'

export function useAccounts() {
  return useLiveQuery(() => listAllAccounts(), [])
}
