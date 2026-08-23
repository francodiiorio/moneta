import { db } from '../db'
import type { InvestmentAsset, InvestmentHolding } from '@/domain/entities'
import { quantity } from '@/domain/decimal'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'

export interface CreateInvestmentAssetInput {
  name: string
  symbol?: string
  type: InvestmentAsset['type']
  currency: InvestmentAsset['currency']
  priceMode: InvestmentAsset['priceMode']
  externalId?: string
}

export type UpdateInvestmentAssetInput = Partial<
  Pick<InvestmentAsset, 'name' | 'symbol' | 'priceMode' | 'externalId'>
>

export interface CreateInvestmentHoldingInput {
  assetId: string
  quantity: InvestmentHolding['quantity']
  averageCost?: InvestmentHolding['averageCost']
  notes?: string
}

export type UpdateInvestmentHoldingInput = Partial<Pick<InvestmentHolding, 'quantity' | 'averageCost' | 'notes'>>

export async function listInvestmentAssets(): Promise<InvestmentAsset[]> {
  return db.investmentAssets.toArray()
}

export async function getInvestmentAsset(id: string): Promise<InvestmentAsset | undefined> {
  return db.investmentAssets.get(id)
}

export async function createInvestmentAsset(input: CreateInvestmentAssetInput): Promise<InvestmentAsset> {
  const now = new Date().toISOString()
  const asset: InvestmentAsset = {
    id: generateId(),
    name: input.name,
    type: input.type,
    currency: input.currency,
    priceMode: input.priceMode,
    createdAt: now,
    updatedAt: now,
    ...(input.symbol !== undefined && { symbol: input.symbol }),
    ...(input.externalId !== undefined && { externalId: input.externalId }),
  }
  await db.investmentAssets.add(asset)
  return asset
}

export async function updateInvestmentAsset(id: string, patch: UpdateInvestmentAssetInput): Promise<void> {
  await db.investmentAssets.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteInvestmentAsset(id: string): Promise<void> {
  await db.transaction('rw', db.investmentAssets, db.investmentHoldings, db.assetPrices, async () => {
    const holdingCount = await db.investmentHoldings.where('assetId').equals(id).count()
    invariant(holdingCount === 0, 'No se puede borrar un activo con posiciones cargadas — borrá las posiciones primero')
    await db.assetPrices.where('assetId').equals(id).delete()
    await db.investmentAssets.delete(id)
  })
}

export async function listInvestmentHoldings(): Promise<InvestmentHolding[]> {
  return db.investmentHoldings.toArray()
}

export async function getInvestmentHolding(id: string): Promise<InvestmentHolding | undefined> {
  return db.investmentHoldings.get(id)
}

export async function createInvestmentHolding(input: CreateInvestmentHoldingInput): Promise<InvestmentHolding> {
  const asset = await db.investmentAssets.get(input.assetId)
  invariant(asset, `Activo no encontrado: ${input.assetId}`)
  // Defense in depth, same as createAssetPrice's `price > 0` check — the
  // form already validates this, but the repo shouldn't trust every
  // future caller to (e.g. a backup import calling this directly).
  quantity(input.quantity)

  const now = new Date().toISOString()
  const holding: InvestmentHolding = {
    id: generateId(),
    assetId: input.assetId,
    quantity: input.quantity,
    createdAt: now,
    updatedAt: now,
    ...(input.averageCost !== undefined && { averageCost: input.averageCost }),
    ...(input.notes !== undefined && { notes: input.notes }),
  }
  await db.investmentHoldings.add(holding)
  return holding
}

export async function updateInvestmentHolding(id: string, patch: UpdateInvestmentHoldingInput): Promise<void> {
  await db.investmentHoldings.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteInvestmentHolding(id: string): Promise<void> {
  await db.investmentHoldings.delete(id)
}
