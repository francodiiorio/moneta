import type { BackupDataV1 } from '../schemas/v1'
import type { BackupDataV2 } from '../schemas/v2'

/** A v1 backup predates the patrimonio tables — they simply didn't exist
 *  yet, so they migrate to empty arrays rather than any inferred data. */
export function migrateV1ToV2(data: BackupDataV1): BackupDataV2 {
  return {
    ...data,
    savingsHoldings: [],
    investmentAssets: [],
    investmentHoldings: [],
    assetPrices: [],
  }
}
