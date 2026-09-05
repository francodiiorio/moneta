import { useLiveQuery } from 'dexie-react-hooks'
import { getExpenseHistory } from '../service'

export function useExpenseHistory(monthsBack = 6) {
  return useLiveQuery(() => getExpenseHistory(monthsBack), [monthsBack])
}
