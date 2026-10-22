import { useLiveQuery } from 'dexie-react-hooks'
import { getNetWorthMonthChange } from '../service'

export function useNetWorthMonthChange() {
  return useLiveQuery(() => getNetWorthMonthChange(), [])
}
