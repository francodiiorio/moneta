import { useLiveQuery } from 'dexie-react-hooks'
import { listAccounts } from '../service'

export function useAccounts() {
  return useLiveQuery(() => listAccounts(), [])
}
