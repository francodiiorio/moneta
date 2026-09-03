import { useLiveQuery } from 'dexie-react-hooks'
import { getSavingsAndInvestmentsHistory } from '../service'

export function useSavingsAndInvestmentsHistory() {
  return useLiveQuery(() => getSavingsAndInvestmentsHistory(), [])
}
