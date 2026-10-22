import { divideHalfUp, isSafeBigInt, QUANTITY_SCALE, quantity, valuePosition, type Quantity } from '@/domain/decimal'
import { minor, sumMoney, type Minor, type Money } from '@/domain/money'
import { invariant } from '@/lib/invariant'
import type { InvestmentLot } from '@/domain/entities'
import type { DateStamp } from '@/lib/dates'

export interface LotInput {
  quantity: Quantity
  /** Undefined when this purchase's cost wasn't loaded — same optionality
   *  `InvestmentHolding.averageCost` already had. All lots for one asset
   *  share the same currency (the asset's). */
  costPerUnit?: Money
}

export interface LotAggregate {
  quantity: Quantity
  /** Weighted average cost per unit, across every lot — undefined
   *  whenever `lots` is empty OR at least one lot has no `costPerUnit`.
   *  Averaging only the costed lots and applying that average to the
   *  full quantity would invent precision that doesn't exist, so a
   *  single uncosted lot makes the whole aggregate uncosted — same
   *  "don't guess" rule as a missing exchange rate elsewhere in the app. */
  averageCost?: Minor
}

/** `InvestmentHolding` is always this: the sum of its `InvestmentLot`s,
 *  never edited directly. Reuses `valuePosition`/`sumMoney` — same
 *  quantity -> native value order as everywhere else, summed lot by lot
 *  (never a naive average of per-lot averages, which loses precision
 *  once lots have different sizes). */
export function aggregateLots(lots: readonly LotInput[]): LotAggregate {
  const totalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0)
  invariant(Number.isSafeInteger(totalQuantity), `Lot quantities overflow safe integer range (sum=${totalQuantity})`)

  const allCosted = lots.length > 0 && lots.every((lot) => lot.costPerUnit !== undefined)
  if (!allCosted || totalQuantity === 0) {
    return { quantity: quantity(totalQuantity) }
  }

  const currency = lots[0]!.costPerUnit!.currency
  const totalCost = sumMoney(
    currency,
    lots.map((lot) => valuePosition(lot.quantity, lot.costPerUnit!)),
  )
  // Inverse of valuePosition (quantity × price / QUANTITY_SCALE): recovers
  // a per-unit price from a total cost and a total quantity. Same BigInt
  // reasoning as valuePosition itself — totalCost.amount × QUANTITY_SCALE
  // (1e8) is routinely past Number.MAX_SAFE_INTEGER as an intermediate
  // product for a peso-denominated instrument, even when the resulting
  // averageCost is perfectly ordinary.
  const scaledCost = BigInt(totalCost.amount) * BigInt(QUANTITY_SCALE)
  const averageCostBig = divideHalfUp(scaledCost, BigInt(totalQuantity))
  invariant(isSafeBigInt(averageCostBig), `Lot total cost overflows safe integer range (cost=${totalCost.amount})`)
  const averageCost = minor(Number(averageCostBig))

  return { quantity: quantity(totalQuantity), averageCost }
}

export interface HoldingQuantity {
  assetId: string
  quantity: number
}

/**
 * Each holding's quantity as the net worth history should value it at
 * `date`: today's quantity, minus purchases PAID FROM AN ACCOUNT after
 * `date`. Those purchases' money is still in the account's balance at
 * `date` (account balances do have history), so counting the position
 * they became as well would count the same money twice — a fake drop in
 * every month with a purchase. Purchases without a source account keep
 * the "cantidades de hoy" rule (see ADR "Evolución del patrimonio"): their
 * money was never in any tracked account.
 */
export function holdingsAsOf(
  holdings: readonly HoldingQuantity[],
  sourcedLots: readonly Pick<InvestmentLot, 'assetId' | 'quantity' | 'date' | 'sourceAccountId'>[],
  date: DateStamp,
): HoldingQuantity[] {
  const laterByAsset = new Map<string, number>()
  for (const lot of sourcedLots) {
    if (lot.sourceAccountId === undefined || lot.date <= date) continue
    laterByAsset.set(lot.assetId, (laterByAsset.get(lot.assetId) ?? 0) + lot.quantity)
  }
  return holdings.map((holding) => {
    const later = laterByAsset.get(holding.assetId) ?? 0
    // A holding is the sum of its lots, so this can't go negative — the
    // clamp only guards data that somehow broke that invariant.
    return { assetId: holding.assetId, quantity: quantity(Math.max(0, holding.quantity - later)) }
  })
}
