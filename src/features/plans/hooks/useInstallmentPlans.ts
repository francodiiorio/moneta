import { useLiveQuery } from 'dexie-react-hooks'
import { listInstallmentPlansWithProgress } from '../service'

export function useInstallmentPlans() {
  return useLiveQuery(() => listInstallmentPlansWithProgress(), [])
}
