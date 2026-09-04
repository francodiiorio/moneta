import { db } from '../db'
import type { InvestmentHolding, InvestmentLot } from '@/domain/entities'
import { aggregateLots } from '@/domain/investments'
import { quantity } from '@/domain/decimal'
import { money, type CurrencyCode } from '@/domain/money'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import type { DateStamp } from '@/lib/dates'

export interface CreateInvestmentLotInput {
  assetId: string
  quantity: InvestmentLot['quantity']
  costPerUnit?: InvestmentLot['costPerUnit']
  currency: CurrencyCode
  date: DateStamp
  notes?: string
}

/** `costPerUnit: null` clears it explicitly; omitted leaves it untouched;
 *  a value sets it. Needs its own tri-state (unlike `quantity`/`date`,
 *  which never go from "has a value" to "has none") because a lot can
 *  lose its cost the same way a holding's `averageCost` can — see
 *  `updateInvestmentLot` below. */
export type UpdateInvestmentLotInput = Partial<Pick<InvestmentLot, 'quantity' | 'date' | 'notes'>> & {
  costPerUnit?: InvestmentLot['costPerUnit'] | null
}

export async function listInvestmentLots(assetId: string): Promise<InvestmentLot[]> {
  return db.investmentLots.where('assetId').equals(assetId).sortBy('date')
}

export async function getInvestmentLot(id: string): Promise<InvestmentLot | undefined> {
  return db.investmentLots.get(id)
}

/** Recalculates and upserts (or deletes, if no lots remain) the cached
 *  `InvestmentHolding` aggregate for `assetId` from its `InvestmentLot`
 *  rows — the only place besides the domain layer itself that knows
 *  lots -> aggregate. Always the last step inside the same transaction
 *  as a lot write, so the aggregate never observes a partial lot set.
 *
 *  A full `put()`, not `update()`: `averageCost` can go from defined to
 *  undefined (e.g. the only costed lot just got deleted), and Dexie's
 *  `update()` can't remove a field that's simply absent from the patch —
 *  it leaves the old value in place. `put()` replaces the whole row, so
 *  there's no ambiguity. */
async function recomputeHoldingAggregate(assetId: string): Promise<void> {
  const lots = await db.investmentLots.where('assetId').equals(assetId).toArray()
  const existing = await db.investmentHoldings.where('assetId').equals(assetId).first()

  if (lots.length === 0) {
    if (existing) await db.investmentHoldings.delete(existing.id)
    return
  }

  const { quantity: totalQuantity, averageCost } = aggregateLots(
    lots.map((lot) => ({
      quantity: quantity(lot.quantity),
      ...(lot.costPerUnit !== undefined && { costPerUnit: money(lot.costPerUnit, lot.currency) }),
    })),
  )
  const now = new Date().toISOString()
  const holding: InvestmentHolding = {
    id: existing?.id ?? generateId(),
    assetId,
    quantity: totalQuantity,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(averageCost !== undefined && { averageCost }),
    ...(existing?.notes !== undefined && { notes: existing.notes }),
  }
  await db.investmentHoldings.put(holding)
}

export async function createInvestmentLot(input: CreateInvestmentLotInput): Promise<InvestmentLot> {
  const now = new Date().toISOString()
  const lot: InvestmentLot = {
    id: generateId(),
    assetId: input.assetId,
    quantity: input.quantity,
    currency: input.currency,
    date: input.date,
    createdAt: now,
    updatedAt: now,
    ...(input.costPerUnit !== undefined && { costPerUnit: input.costPerUnit }),
    ...(input.notes !== undefined && { notes: input.notes }),
  }

  await db.transaction('rw', db.investmentAssets, db.investmentHoldings, db.investmentLots, async () => {
    const asset = await db.investmentAssets.get(input.assetId)
    invariant(asset, `Activo no encontrado: ${input.assetId}`)
    // Defense in depth, same reasoning as investments.repo.ts's own
    // quantity check — the form already validates > 0 and passes the
    // asset's own currency, but a lot in the wrong currency would let
    // aggregateLots silently average costs across currencies.
    invariant(input.currency === asset.currency, `Moneda del lote (${input.currency}) no coincide con la del activo (${asset.currency})`)
    quantity(input.quantity)

    await db.investmentLots.add(lot)
    await recomputeHoldingAggregate(input.assetId)
  })

  return lot
}

/** A full `put()`, not `update()` — same reasoning as
 *  `recomputeHoldingAggregate`: `costPerUnit` can go from defined to
 *  absent (the user clears "Costo por unidad" on an already-costed lot),
 *  and Dexie's `update()` can't remove a field that's simply missing
 *  from the patch, it leaves the old value in place. `patch.costPerUnit`
 *  is therefore tri-state — see `UpdateInvestmentLotInput`. */
export async function updateInvestmentLot(id: string, patch: UpdateInvestmentLotInput): Promise<void> {
  await db.transaction('rw', db.investmentHoldings, db.investmentLots, async () => {
    const lot = await db.investmentLots.get(id)
    invariant(lot, `Compra no encontrada: ${id}`)
    if (patch.quantity !== undefined) quantity(patch.quantity)

    const updated: InvestmentLot = {
      ...lot,
      ...(patch.quantity !== undefined && { quantity: patch.quantity }),
      ...(patch.date !== undefined && { date: patch.date }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      updatedAt: new Date().toISOString(),
    }
    if (patch.costPerUnit === null) {
      delete updated.costPerUnit
    } else if (patch.costPerUnit !== undefined) {
      updated.costPerUnit = patch.costPerUnit
    }

    await db.investmentLots.put(updated)
    await recomputeHoldingAggregate(lot.assetId)
  })
}

export async function deleteInvestmentLot(id: string): Promise<void> {
  await db.transaction('rw', db.investmentHoldings, db.investmentLots, async () => {
    const lot = await db.investmentLots.get(id)
    if (!lot) return
    await db.investmentLots.delete(id)
    await recomputeHoldingAggregate(lot.assetId)
  })
}
