import { useLiveQuery } from 'dexie-react-hooks'
import { settingsRepo } from '@/database/repositories'

export function useSettings() {
  return useLiveQuery(() => settingsRepo.getSettings(), [])
}
