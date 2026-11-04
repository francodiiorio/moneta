import { convert, MissingRateError } from '@/domain/currency'
import type { ExchangeRate, Expense } from '@/domain/entities'
import { add, zero, type CurrencyCode, type Money } from '@/domain/money'
import type { DateStamp } from '@/lib/dates'

/** One gasto to total: its magnitude, in its own currency. */
export interface SpendingItem {
  amount: Money
  status: Expense['status']
  date: DateStamp
}

export interface SpendingTotals {
  /** Gastos already made (`confirmed`), in the base currency. */
  spent: Money
  /** Gastos still to come (`projected`): a cuota not due yet, or a gasto
   *  fijo the caller adds before it's generated. */
  pending: Money
  /** Gastos left out for lack of an exchange rate — never assumed 1:1. */
  missingRateCount: number
}

/** What a list of gastos adds up to in `baseCurrency`, each converted at
 *  its own date (same rule as Reportes). */
export function spendingTotals(
  items: readonly SpendingItem[],
  baseCurrency: CurrencyCode,
  rates: readonly ExchangeRate[],
  profile?: string,
): SpendingTotals {
  let spent = zero(baseCurrency)
  let pending = zero(baseCurrency)
  let missingRateCount = 0
  for (const item of items) {
    let converted: Money
    try {
      converted = convert(item.amount, baseCurrency, rates, item.date, profile)
    } catch (error) {
      if (!(error instanceof MissingRateError)) throw error
      missingRateCount += 1
      continue
    }
    if (item.status === 'confirmed') spent = add(spent, converted)
    else pending = add(pending, converted)
  }
  return { spent, pending, missingRateCount }
}
