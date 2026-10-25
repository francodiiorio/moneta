import { useLiveQuery } from 'dexie-react-hooks'
import type { DateStamp } from '@/lib/dates'
import { cuotaInOpenStatementFor, openStatementHasOpening } from '../service'

/** With a card, which cuota of a purchase on `purchaseDate` the statement
 *  open today bills; `undefined` without a card or while loading. */
export function useCuotaInOpenStatement(cardId: string, purchaseDate: DateStamp) {
  return useLiveQuery(
    async () => (cardId && purchaseDate ? cuotaInOpenStatementFor(cardId, purchaseDate) : undefined),
    [cardId, purchaseDate],
  )
}

/** Whether the card's opening balance covers today's statement in
 *  `currency` — then the cuota there may already be inside it. */
export function useOpenStatementHasOpening(cardId: string, currency: string) {
  return useLiveQuery(async () => (cardId ? openStatementHasOpening(cardId, currency) : false), [cardId, currency])
}
