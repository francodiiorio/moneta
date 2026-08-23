import { useLiveQuery } from 'dexie-react-hooks'
import { listRecurringPlansWithNext } from '../service'

export function useRecurringPlans() {
  return useLiveQuery(() => listRecurringPlansWithNext(), [])
}
