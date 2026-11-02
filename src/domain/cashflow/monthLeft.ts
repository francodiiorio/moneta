import { sub, type Money } from '@/domain/money'

/** One month's money, all in one currency (the base one). */
export interface MonthFlow {
  /** Ingresos: cobrados y por cobrar (a salary still to come). */
  income: Money
  /** Gastos fijos not paid with a card (a card's go into its statement). */
  fixed: Money
  /** The card statements due this month — what leaves the accounts to pay them. */
  cards: Money
  /** Every other gasto not paid with a card (debit, cash, a loan's cuota). */
  other: Money
}

/**
 * What's left of the month: what comes in minus what goes out — card
 * purchases counted once, through the statement that's due this month
 * (not on their own dates), so nothing is counted twice. Negative when
 * the month doesn't cover it.
 */
export function monthLeft({ income, fixed, cards, other }: MonthFlow): Money {
  return sub(sub(sub(income, fixed), cards), other)
}
