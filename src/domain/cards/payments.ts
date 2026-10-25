import type { Account, StatementPayment } from '@/domain/entities'
import { money, sub, sumMoney, type Money } from '@/domain/money'
import { movementAccountProblem } from '@/domain/accounts'
import { isValidDateStamp, type DateStamp } from '@/lib/dates'

export type PaymentStatus = 'unpaid' | 'paid' | 'mismatch'

export interface StatementPaymentState {
  status: PaymentStatus
  /** Per currency: what's still owed (positive) or was overpaid
   *  (negative) — only the currencies that don't match, empty when paid.
   *  For 'unpaid' it's simply the totals. */
  differences: Money[]
}

/**
 * Whether a statement is paid, comparing what was paid with Moneta's total
 * per currency. 'paid' when every currency matches exactly; 'mismatch' when
 * something was paid but some currency differs — paid for what the bank
 * charged (more or less than Moneta has), a currency still unpaid, a total
 * that changed later — and `differences` says by how much (total − paid).
 * No payment at all is 'unpaid', even for an empty statement (callers
 * decide whether an empty one needs paying).
 */
export function statementPaymentState(
  totals: readonly Money[],
  payments: readonly Pick<StatementPayment, 'currency' | 'amount'>[],
): StatementPaymentState {
  if (payments.length === 0) return { status: 'unpaid', differences: [...totals] }

  const currencies = [...new Set([...totals.map((t) => t.currency), ...payments.map((p) => p.currency)])].sort()
  const differences: Money[] = []
  for (const currency of currencies) {
    const total = totals.find((t) => t.currency === currency) ?? money(0, currency)
    const paid = sumMoney(
      currency,
      payments.filter((p) => p.currency === currency).map((p) => money(p.amount, p.currency)),
    )
    const difference = sub(total, paid)
    if (difference.amount !== 0) differences.push(difference)
  }
  return { status: differences.length === 0 ? 'paid' : 'mismatch', differences }
}

/**
 * Why `payment` can't be recorded from `account`, or `undefined` if it
 * can — shared by the repository and backup validation. The debit is a
 * movement of the account (its currency, not before its opening date);
 * paying in the account's own currency debits exactly the amount paid.
 */
export function statementPaymentProblem(
  payment: Pick<StatementPayment, 'currency' | 'amount' | 'debitedAmount' | 'debitedCurrency' | 'date'>,
  account: Pick<Account, 'name' | 'currency' | 'openingDate'>,
): string | undefined {
  if (payment.amount <= 0 || payment.debitedAmount <= 0) return 'Los montos tienen que ser mayores a cero'
  const problem = movementAccountProblem(account, { date: payment.date, currency: payment.debitedCurrency })
  if (problem) return problem
  if (payment.currency === payment.debitedCurrency && payment.amount !== payment.debitedAmount) {
    return 'Pagando en la misma moneda, el monto debitado tiene que ser lo pagado'
  }
  return undefined
}

/**
 * Why `lines` can't pay a statement, or `undefined` if they can. A
 * statement is paid once, by what the bank actually charged (ADR "Pago
 * por lo que realmente pagaste"): at least one line, each currency once,
 * each amount above zero. It doesn't have to match Moneta's total — a
 * difference stays visible (statementPaymentState) and can be reconciled.
 */
export function statementPaymentLinesProblem(lines: readonly { currency: string; amount: number }[]): string | undefined {
  if (lines.length === 0) return 'Cargá lo que pagaste en al menos una moneda'
  const currencies = new Set(lines.map((l) => l.currency))
  if (currencies.size !== lines.length) return 'Una sola línea por moneda'
  if (lines.some((l) => !Number.isSafeInteger(l.amount) || l.amount <= 0)) return 'Los montos tienen que ser mayores a cero'
  return undefined
}

/** A statement is paid once billed: never before it closes. Checked when
 *  paying, not on import — an override corrected later may move the close
 *  past an old payment, and that history must still import. */
export function statementPaymentDateProblem(date: DateStamp, closeDate: DateStamp): string | undefined {
  // Built before the type guard (it narrows `date` to `never` when false).
  const invalid = `Fecha inválida: ${date}`
  if (!isValidDateStamp(date)) return invalid
  if (date < closeDate) return 'La fecha del pago no puede ser anterior al cierre del resumen'
  return undefined
}
