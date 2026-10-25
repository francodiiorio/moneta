import { useLiveQuery } from 'dexie-react-hooks'
import { getOnboarding } from '../service'

export function useOnboarding() {
  return useLiveQuery(() => getOnboarding(), [])
}
