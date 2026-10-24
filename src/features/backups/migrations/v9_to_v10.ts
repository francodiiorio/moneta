import type { BackupDataV9 } from '../schemas/v9'
import type { BackupDataV10 } from '../schemas/v10'

/** Etapa 8, Fase 5: a v9 file had no statement payments — the table
 *  starts empty (every statement unpaid). Purely additive. */
export function migrateV9ToV10(data: BackupDataV9): BackupDataV10 {
  return { ...data, statementPayments: [] }
}
