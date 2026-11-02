import { useLiveQuery } from 'dexie-react-hooks'
import { listQuickPicks } from '../service'
import type { MovementKind } from '../schema'

export function useQuickPicks(kind: MovementKind) {
  return useLiveQuery(() => listQuickPicks(kind), [kind])
}
