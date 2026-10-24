import type { BackupDataV8 } from '../schemas/v8'
import type { BackupDataV9 } from '../schemas/v9'

/** Etapa 8, Fase 4b: no v8 plan had a payment method (the frozen v8 shape
 *  already stripped any stray ledger-era `accountId`), so every plan stays
 *  exactly as it was. Purely additive. */
export function migrateV8ToV9(data: BackupDataV8): BackupDataV9 {
  return { ...data }
}
