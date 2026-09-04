import { QUANTITY_SCALE, quantity, valuePosition, type Quantity } from '@/domain/decimal'
import { minor, roundHalfUp, sumMoney, type Minor, type Money } from '@/domain/money'
import { invariant } from '@/lib/invariant'

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
  // a per-unit price from a total cost and a total quantity.
  const scaledCost = totalCost.amount * QUANTITY_SCALE
  invariant(Number.isSafeInteger(scaledCost), `Lot total cost overflows safe integer range (cost=${totalCost.amount})`)
  const averageCost = minor(roundHalfUp(scaledCost / totalQuantity))

  return { quantity: quantity(totalQuantity), averageCost }
}
