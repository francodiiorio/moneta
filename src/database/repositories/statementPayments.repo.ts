import { db } from '../db'
import {
  statementDates,
  statementPaymentDateProblem,
  statementPaymentLinesProblem,
  statementPaymentProblem,
} from '@/domain/cards'
import type { StatementPayment } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { shiftMonth, type DateStamp, type MonthStamp } from '@/lib/dates'
import { getCardCalendar } from './creditCards.repo'

export async function listStatementPayments(cardId: string, period?: MonthStamp): Promise<StatementPayment[]> {
  const payments = await db.statementPayments.where('cardId').equals(cardId).toArray()
  return period === undefined ? payments : payments.filter((p) => p.period === period)
}

export async function listStatementPaymentsInRange(start: DateStamp, end: DateStamp): Promise<StatementPayment[]> {
  return db.statementPayments.where('date').between(start, end, true, true).toArray()
}

export interface PaymentLineInput {
  /** The statement currency this line pays. */
  currency: string
  /** What was paid of the statement in that currency — what the bank
   *  charged, which may differ from Moneta's total (see ADR). */
  amount: number
  accountId: string
  /** What left the account, in the account's currency. Omitted when the
   *  account is in the statement's currency: then it's `amount`. */
  debitedAmount?: number
  /** The account currency the caller parsed `debitedAmount` in — checked
   *  against the account inside the transaction (same reason as
   *  transfers.repo.ts). */
  expectedAccountCurrency: string
}

export interface PayStatementInput {
  cardId: string
  period: MonthStamp
  date: DateStamp
  lines: readonly PaymentLineInput[]
}

/**
 * Pays a statement, one line per currency — each currency once, possibly on
 * different days — by what was actually paid
 * — Moneta's total may differ (a charge not loaded, interest, taxes): the
 * statement is then "pagado con diferencia" and the difference can be
 * reconciled. Never creates a gasto: the purchases were already counted.
 */
export async function payStatement(input: PayStatementInput): Promise<StatementPayment[]> {
  const tables = [db.statementPayments, db.accounts, db.creditCards, db.cardStatements]
  return db.transaction('rw', tables, async () => {
    const calendar = await getCardCalendar(input.cardId)
    const dateProblem = statementPaymentDateProblem(input.date, statementDates(calendar, input.period).closeDate)
    invariant(dateProblem === undefined, dateProblem ?? '')
    const linesProblem = statementPaymentLinesProblem(input.lines)
    invariant(linesProblem === undefined, linesProblem ?? '')
    // Each currency is paid once, on its own day if need be (pesos today,
    // dollars when bought): only a currency already paid is rejected.
    const existing = await listStatementPayments(input.cardId, input.period)
    for (const line of input.lines) {
      invariant(
        !existing.some((p) => p.currency === line.currency),
        `Ese resumen ya tiene un pago en ${line.currency} — deshacé el pago para volver a cargarlo`,
      )
    }

    const now = new Date().toISOString()
    const payments: StatementPayment[] = []
    for (const line of input.lines) {
      const account = await db.accounts.get(line.accountId)
      invariant(account, `Cuenta no encontrada: ${line.accountId}`)
      invariant(
        account.currency === line.expectedAccountCurrency,
        'La moneda de una cuenta cambió mientras cargabas el pago — volvé a intentarlo',
      )
      const debitedAmount = line.debitedAmount ?? (account.currency === line.currency ? line.amount : undefined)
      invariant(debitedAmount !== undefined, `Ingresá cuánto se debitó de "${account.name}" en ${account.currency}`)
      invariant(Number.isInteger(debitedAmount), `Monto debitado inválido: ${debitedAmount}`)
      const payment: StatementPayment = {
        id: generateId(),
        cardId: input.cardId,
        period: input.period,
        currency: line.currency,
        amount: line.amount,
        accountId: account.id,
        debitedAmount,
        debitedCurrency: account.currency,
        date: input.date,
        createdAt: now,
        updatedAt: now,
      }
      const problem = statementPaymentProblem(payment, account)
      invariant(problem === undefined, problem ?? '')
      payments.push(payment)
    }
    await db.statementPayments.bulkAdd(payments)
    return payments
  })
}

export async function isStatementPaid(cardId: string, period: MonthStamp): Promise<boolean> {
  return (await db.statementPayments.where('cardId').equals(cardId).filter((p) => p.period === period).count()) > 0
}

/** Correcting a statement's close moves gastos only between it and the
 *  next one — neither may be paid: re-placing gastos under a payment would
 *  silently change its difference with what was paid. Callers' transactions must include `statementPayments`. */
export async function assertCloseCanMove(cardId: string, period: MonthStamp): Promise<void> {
  for (const p of [period, shiftMonth(period, 1)]) {
    invariant(
      !(await isStatementPaid(cardId, p)),
      'Ese resumen o el siguiente ya están pagados — deshacé el pago antes de corregir las fechas',
    )
  }
}

/** Undoes a statement's payment (every currency) — the debit goes back
 *  to each account. */
export async function undoStatementPayment(cardId: string, period: MonthStamp): Promise<number> {
  return db.statementPayments.where('cardId').equals(cardId).filter((p) => p.period === period).delete()
}
