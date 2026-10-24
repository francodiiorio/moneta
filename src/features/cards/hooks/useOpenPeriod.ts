import { useLiveQuery } from 'dexie-react-hooks'
import { getOpenPeriod } from '../service'

/** `null` when the card doesn't exist, `undefined` while loading. */
export function useOpenPeriod(cardId: string) {
  return useLiveQuery(() => getOpenPeriod(cardId), [cardId])
}
