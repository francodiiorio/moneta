import { useLiveQuery } from 'dexie-react-hooks'
import { getNetWorthHistory } from '../service'

export function useNetWorthHistory(monthsBack = 6) {
  return useLiveQuery(() => getNetWorthHistory(monthsBack), [monthsBack])
}
