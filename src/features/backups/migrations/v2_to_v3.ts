import type { InvestmentLot } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import type { BackupDataV2 } from '../schemas/v2'
import type { BackupDataV3 } from '../schemas/v3'

/** A v2 backup predates lot tracking — every `InvestmentHolding` it has
 *  is grandfathered into one inherited `InvestmentLot` each, same logic
 *  as `database/db.ts`'s own `version(3).upgrade()` (this path exists
 *  because import/merge writes tables directly and never runs that
 *  Dexie upgrade). See ADR "Tracking de inversiones por lote" in
 *  docs/DECISIONS.md. */
export function migrateV2ToV3(data: BackupDataV2): BackupDataV3 {
  const assetById = new Map(data.investmentAssets.map((a) => [a.id, a]))
  const investmentLots: InvestmentLot[] = data.investmentHoldings
    .filter((h) => h.quantity > 0)
    .map((h) => ({
      id: generateId(),
      assetId: h.assetId,
      quantity: h.quantity,
      // Un holding sin su asset no debería existir (deleteInvestmentAsset
      // lo bloquea), pero un backup puede haber sido editado a mano.
      currency: assetById.get(h.assetId)?.currency ?? 'ARS',
      date: h.createdAt.slice(0, 10),
      createdAt: h.createdAt,
      updatedAt: h.createdAt,
      ...(h.averageCost !== undefined && { costPerUnit: h.averageCost }),
    }))

  return { ...data, investmentLots }
}
