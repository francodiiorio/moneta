import type { BackupDataV6 } from '../schemas/v6'
import type { BackupDataV7 } from '../schemas/v7'

/** Etapa 8, Fase 3: a v6 lot never had a source account — every lot stays
 *  exactly as it was (none of them debits an account). Purely additive. */
export function migrateV6ToV7(data: BackupDataV6): BackupDataV7 {
  return { ...data }
}
