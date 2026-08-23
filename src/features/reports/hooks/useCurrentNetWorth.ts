import { useLiveQuery } from 'dexie-react-hooks'
import { getCurrentNetWorth } from '../service'

export function useCurrentNetWorth() {
  return useLiveQuery(() => getCurrentNetWorth(), [])
}
