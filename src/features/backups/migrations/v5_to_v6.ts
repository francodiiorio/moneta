import type { BackupDataV5 } from '../schemas/v5'
import type { BackupDataV6 } from '../schemas/v6'

/** Etapa 8, Fase 2: a v5 file had no transferencias — the table starts
 *  empty. Purely additive, nothing in the v5 data changes. */
export function migrateV5ToV6(data: BackupDataV5): BackupDataV6 {
  return { ...data, transfers: [] }
}
