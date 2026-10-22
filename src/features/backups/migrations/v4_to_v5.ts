import type { BackupDataV4 } from '../schemas/v4'
import type { BackupDataV5 } from '../schemas/v5'

/**
 * Same as `database/db.ts`'s `version(5)` Dexie upgrade, for an imported
 * file: every category becomes an expense category (v4 had no other
 * kind — the v3→v4 migration had already dropped income categories), and
 * the three Etapa 8 tables start empty. Purely additive: nothing a v4
 * file contains is dropped or reinterpreted.
 */
export function migrateV4ToV5(data: BackupDataV4): BackupDataV5 {
  return {
    ...data,
    categories: data.categories.map((category) => ({ ...category, kind: 'expense' as const })),
    accounts: [],
    incomes: [],
    accountAdjustments: [],
  }
}
