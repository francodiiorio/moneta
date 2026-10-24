import { useLiveQuery } from 'dexie-react-hooks'
import { cardStatementChoices, listImportTargets } from '../service'

export function useImportTargets() {
  return useLiveQuery(() => listImportTargets(), [])
}

export function useCardStatementChoices(cardId: string | undefined) {
  return useLiveQuery(async () => (cardId ? cardStatementChoices(cardId) : []), [cardId])
}
