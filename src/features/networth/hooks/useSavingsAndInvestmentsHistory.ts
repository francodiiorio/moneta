import { useLiveQuery } from 'dexie-react-hooks'
import { getSavingsAndInvestmentsHistory } from '../service'

export function useSavingsAndInvestmentsHistory(monthsBack = 6) {
  return useLiveQuery(() => getSavingsAndInvestmentsHistory(monthsBack), [monthsBack])
}
