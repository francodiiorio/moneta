import type { BackupDataV7 } from '../schemas/v7'
import type { BackupDataV8 } from '../schemas/v8'

/** Etapa 8, Fase 4: a v7 file had no credit cards — both tables start
 *  empty and no gasto is on a card. Purely additive. */
export function migrateV7ToV8(data: BackupDataV7): BackupDataV8 {
  return { ...data, creditCards: [], cardStatements: [] }
}
