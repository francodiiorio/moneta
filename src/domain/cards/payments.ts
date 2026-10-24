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
 * Whether a statement is paid. Only full payment exists: a statement is
 * 'paid' when every currency in its totals has payments adding up to
 * exactly that total (and nothing was paid in a currency it doesn't have).
 * 'mismatch' means it was paid but its total changed afterwards — a late
 * presentation billed into it, an edited gasto — and `differences` says
 * by how much. No payment at all is 'unpaid', even for an empty statement
 * (callers decide whether an empty one needs paying).
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
    return 'Pagando en la misma moneda, el monto debitado tiene que ser el del resumen'
  }
  return undefined
}

/**
 * Why paying a statement with `lines` isn't a full payment, or `undefined`
 * if it is — only full payment exists (see ADR): the statement has
 * something to pay, every currency of its totals gets exactly one line,
 * and each line pays the total the user was shown (`expectedAmount`),
 * which must still be the current one.
 */
export function statementPaymentLinesProblem(
  totals: readonly Money[],
  lines: readonly { currency: string; expectedAmount: number }[],
): string | undefined {
  if (totals.length === 0) return 'El resumen no tiene gastos para pagar'
  const owed = new Set(totals.map((t) => t.currency))
  const paid = new Set(lines.map((l) => l.currency))
  if (paid.size !== lines.length || paid.size !== owed.size || ![...owed].every((c) => paid.has(c))) {
    return `Hay que pagar el resumen completo: ${[...owed].join(' y ')}`
  }
  const changed = lines.some((line) => totals.find((t) => t.currency === line.currency)?.amount !== line.expectedAmount)
  if (changed) return 'El total del resumen cambió mientras cargabas el pago — revisalo y volvé a intentarlo'
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
