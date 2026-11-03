import type { BackupDataV11 } from '../schemas/v11'
import type { BackupDataV12 } from '../schemas/v12'

/** Etapa 10: v12 only relaxes v11 (the account becomes optional), so a
 *  v11 file's data is already valid v12 data. */
export function migrateV11ToV12(data: BackupDataV11): BackupDataV12 {
  return data
}
