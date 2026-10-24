import { useLiveQuery } from 'dexie-react-hooks'
// The cards feature's service, not its components: placing a purchase in
// a statement needs the card calendar + domain logic it already owns (see
// docs/DECISIONS.md "Un feature puede importar el service.ts/hooks de otro").
import { statementChoices } from '@/features/cards/service'
import { isValidDateStamp } from '@/lib/dates'

export function useStatementChoices(cardId: string, date: string) {
  return useLiveQuery(
    async () => (cardId && isValidDateStamp(date) ? statementChoices(cardId, date) : []),
    [cardId, date],
  )
}
