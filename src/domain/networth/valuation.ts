import type { Quantity } from '@/domain/decimal'
import { valuePosition } from '@/domain/decimal'
import type { ExchangeRate, SavingsHolding } from '@/domain/entities'
import { convert, MissingRateError } from '@/domain/currency'
import type { CurrencyCode, Money } from '@/domain/money'
import { money, sumMoney } from '@/domain/money'
import type { DateStamp } from '@/lib/dates'

export interface ValuationPosition {
  quantity: Quantity
  /** Undefined when the asset has never had a price loaded — counted in
   *  `missingPriceCount` and excluded from the total instead of treating
   *  the position as worth zero. */
  price?: Money
}

export interface ValuationInput {
  savings: readonly SavingsHolding[]
  positions: readonly ValuationPosition[]
  rates: readonly ExchangeRate[]
  displayCurrency: CurrencyCode
  date: DateStamp
  profile?: string
}

export interface ValuationResult {
  total: Money
  byBucket: { savings: Money; investments: Money }
  /** Items excluded from the total for lack of a usable exchange rate —
   *  same fail-safe pattern as features/reports/service.ts: never assume
   *  1:1, never let one missing rate blank the whole total. */
  missingRateCount: number
  /** Investment positions excluded for lack of any price at all — kept
   *  separate from missingRateCount since it's a different, unrelated gap
   *  (the position's own price vs. a currency conversion). */
  missingPriceCount: number
}

interface ConvertResult {
  converted: Money[]
  missing: number
}

function tryConvertAll(
  amounts: readonly Money[],
  displayCurrency: CurrencyCode,
  rates: readonly ExchangeRate[],
  date: DateStamp,
  profile: string | undefined,
): ConvertResult {
  const converted: Money[] = []
  let missing = 0
  for (const amount of amounts) {
    try {
      converted.push(convert(amount, displayCurrency, rates, date, profile))
    } catch (error) {
      if (error instanceof MissingRateError) {
        missing += 1
        continue
      }
      throw error
    }
  }
  return { converted, missing }
}

/**
 * Values Ahorros + Inversiones in `displayCurrency`, without ever
 * touching a stored amount. The order for a position is always
 * quantity -> valuePosition (native currency) -> convert (display
 * currency), never a precomputed shortcut — see CLAUDE.md "Reglas
 * financieras" and docs/DECISIONS.md. No Cuentas bucket — ver ADR
 * "Simplificación: se elimina Cuentas, Ingresos y Transferencias".
 */
export function valuateNetWorth(input: ValuationInput): ValuationResult {
  const { savings, positions, rates, displayCurrency, date, profile } = input

  const savingsAmounts = savings.map((s) => money(s.amount, s.currency))

  let missingPriceCount = 0
  const investmentAmounts: Money[] = []
  for (const position of positions) {
    if (!position.price) {
      missingPriceCount += 1
      continue
    }
    investmentAmounts.push(valuePosition(position.quantity, position.price))
  }

  const savingsResult = tryConvertAll(savingsAmounts, displayCurrency, rates, date, profile)
  const investmentsResult = tryConvertAll(investmentAmounts, displayCurrency, rates, date, profile)

  const byBucket = {
    savings: sumMoney(displayCurrency, savingsResult.converted),
    investments: sumMoney(displayCurrency, investmentsResult.converted),
  }

  return {
    total: sumMoney(displayCurrency, [byBucket.savings, byBucket.investments]),
    byBucket,
    missingRateCount: savingsResult.missing + investmentsResult.missing,
    missingPriceCount,
  }
}
