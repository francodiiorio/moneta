import { useLiveQuery } from 'dexie-react-hooks'
import { listPaymentOptions } from '../service'

export function usePaymentOptions() {
  return useLiveQuery(() => listPaymentOptions(), [])
}
