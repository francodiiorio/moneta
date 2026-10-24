import { money, sub, type Money } from '@/domain/money'

/**
 * Per currency the bank's statement shows, how far Moneta's total for it
 * is: bank − Moneta. Positive means the bank billed more than Moneta has
 * (taxes, interest, fees, a purchase never loaded); negative, less (a
 * purchase the bank bills next time, a refund). A currency Moneta has but
 * the bank wasn't given for isn't compared.
 */
export function statementDifferences(totals: readonly Money[], bankTotals: readonly Money[]): Money[] {
  return bankTotals.map((bank) => sub(bank, totals.find((t) => t.currency === bank.currency) ?? money(0, bank.currency)))
}
