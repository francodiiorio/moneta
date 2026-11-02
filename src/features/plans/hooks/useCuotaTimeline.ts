import { useLiveQuery } from 'dexie-react-hooks'
import { getCuotaTimeline } from '../service'

export function useCuotaTimeline() {
  return useLiveQuery(() => getCuotaTimeline(), [])
}
