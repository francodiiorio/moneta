import {
  accountsRepo,
  cardStatementsRepo,
  categoriesRepo,
  creditCardsRepo,
  statementPaymentsRepo,
} from '@/database/repositories'
import {
  openStatement,
  statementDates,
  statementDifferences,
  statementPaymentState,
  statementPeriodFor,
  statementTotals,
  type CardCalendar,
  type StatementDates,
  type StatementPaymentState,
} from '@/domain/cards'
import type { CreditCard, Expense, StatementPayment } from '@/domain/entities'
import { money, parseAmount, tryParseAmount, type Money } from '@/domain/money'
import { daysBetween, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type { CardFormValues, PaymentFormValues, ReconcileFormValues, StatementDatesFormValues } from './schema'

export { setCreditCardArchived, deleteCreditCard, listCreditCards } from '@/database/repositories/creditCards.repo'
export { listAccounts } from '@/database/repositories/accounts.repo'

export type StatementStatus = 'open' | 'closed' | 'upcoming'

/** Where a statement stands on being paid: nothing to pay ('empty'),
 *  paid in full, paid but its total changed afterwards ('mismatch'), or
 *  unpaid — before its due date ('pending') or past it ('overdue').
 *  Unpaid statements older than the last closed one are 'unrecorded': most
 *  were paid before Moneta tracked payments (or outside it), and the bank
 *  rolls a really unpaid one into the next statement anyway — so they're
 *  not flagged as overdue forever. */
export type DueState = 'empty' | 'paid' | 'mismatch' | 'pending' | 'overdue' | 'unrecorded'

export interface StatementView {
  period: MonthStamp
  closeDate: DateStamp
  dueDate: DateStamp
  /** The bank's real dates were entered by hand for this period. */
  isCorrected: boolean
  status: StatementStatus
  /** One per currency — ARS and USD are never added together. */
  totals: Money[]
  expenseCount: number
  /** Future installments already billed into this statement. */
  projectedCount: number
  payment: StatementPaymentState
  due: DueState
}

function statusOf(calendar: CardCalendar, period: MonthStamp, today: DateStamp): StatementStatus {
  const open = statementPeriodFor(calendar, today)
  if (period === open) return 'open'
  return period < open ? 'closed' : 'upcoming'
}

function dueStateOf(
  calendar: CardCalendar,
  period: MonthStamp,
  payment: StatementPaymentState,
  totals: readonly Money[],
  dueDate: DateStamp,
  today: DateStamp,
): DueState {
  if (payment.status === 'paid') return 'paid'
  if (payment.status === 'mismatch') return 'mismatch'
  if (totals.length === 0) return 'empty'
  if (today <= dueDate) return 'pending'
  const lastClosed = shiftMonth(statementPeriodFor(calendar, today), -1)
  return period < lastClosed ? 'unrecorded' : 'overdue'
}

function buildView(
  calendar: CardCalendar,
  period: MonthStamp,
  expenses: readonly Expense[],
  payments: readonly StatementPayment[],
  today: DateStamp,
): StatementView {
  const dates = statementDates(calendar, period)
  const totals = statementTotals(expenses)
  const payment = statementPaymentState(totals, payments)
  return {
    ...dates,
    isCorrected: calendar.overrides.some((o) => o.period === period),
    status: statusOf(calendar, period, today),
    totals,
    expenseCount: expenses.length,
    projectedCount: expenses.filter((e) => e.status === 'projected').length,
    payment,
    due: dueStateOf(calendar, period, payment, totals, dates.dueDate, today),
  }
}

export interface CardSummary {
  card: CreditCard
  /** Where today's purchases go. */
  current: StatementView
  /** The last closed statement — the one being paid now. */
  previous: StatementView
  /** Days until `current` closes and until `previous` is due (negative =
   *  already due). */
  daysToClose: number
  daysToDue: number
}

export async function listCardSummaries(today: DateStamp = todayStamp()): Promise<CardSummary[]> {
  const cards = await creditCardsRepo.listCreditCards()
  return Promise.all(
    cards.map(async (card) => {
      const calendar = await creditCardsRepo.getCardCalendar(card.id)
      const open = openStatement(calendar, today)
      const previousPeriod = shiftMonth(open.period, -1)
      const [currentExpenses, previousExpenses, payments] = await Promise.all([
        cardStatementsRepo.listCardExpenses(card.id, open.period),
        cardStatementsRepo.listCardExpenses(card.id, previousPeriod),
        statementPaymentsRepo.listStatementPayments(card.id),
      ])
      const paymentsOf = (period: MonthStamp) => payments.filter((p) => p.period === period)
      const current = buildView(calendar, open.period, currentExpenses, paymentsOf(open.period), today)
      const previous = buildView(calendar, previousPeriod, previousExpenses, paymentsOf(previousPeriod), today)
      return {
        card,
        current,
        previous,
        daysToClose: daysBetween(today, current.closeDate),
        daysToDue: daysBetween(today, previous.dueDate),
      }
    }),
  )
}

export interface StatementExpenseRow {
  id: string
  date: DateStamp
  description: string
  categoryLabel: string
  amount: Money
  status: 'confirmed' | 'projected'
}

export interface StatementPaymentRow {
  id: string
  date: DateStamp
  accountName: string
  /** What it paid of the statement, in the statement's currency. */
  amount: Money
  /** What left the account — differs from `amount` only across currencies. */
  debited: Money
}

export interface StatementDetail extends StatementView {
  card: CreditCard
  expenses: StatementExpenseRow[]
  payments: StatementPaymentRow[]
}

export async function getStatementDetail(
  cardId: string,
  period: MonthStamp,
  today: DateStamp = todayStamp(),
): Promise<StatementDetail | undefined> {
  const card = await creditCardsRepo.getCreditCard(cardId)
  if (!card) return undefined
  const [calendar, expenses, payments, categories, accounts] = await Promise.all([
    creditCardsRepo.getCardCalendar(cardId),
    cardStatementsRepo.listCardExpenses(cardId, period),
    statementPaymentsRepo.listStatementPayments(cardId, period),
    categoriesRepo.listCategories(),
    accountsRepo.listAccounts(),
  ])
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const view = buildView(calendar, period, expenses, payments, today)
  return {
    ...view,
    card,
    payments: payments
      .map((p) => ({
        id: p.id,
        date: p.date,
        accountName: accountName.get(p.accountId) ?? '—',
        amount: money(p.amount, p.currency),
        debited: money(p.debitedAmount, p.debitedCurrency),
      }))
      .sort((a, b) => a.amount.currency.localeCompare(b.amount.currency)),
    expenses: expenses.map((e) => ({
      id: e.id,
      date: e.date,
      description: e.description,
      categoryLabel: categoryName.get(e.categoryId) ?? '—',
      amount: money(e.amount, e.currency),
      status: e.status,
    })),
  }
}

/** The statement a purchase on `date` would go into, for the expense form
 *  ("entra en el resumen de octubre"). */
export async function suggestStatementPeriod(cardId: string, date: DateStamp): Promise<StatementDates> {
  const calendar = await creditCardsRepo.getCardCalendar(cardId)
  return statementDates(calendar, statementPeriodFor(calendar, date))
}

/** The statements the expense form offers for a purchase on `date`: the
 *  automatic one first, then the next two — for a late presentation the
 *  user already saw billed in a later statement. */
export async function statementChoices(cardId: string, date: DateStamp): Promise<StatementDates[]> {
  const calendar = await creditCardsRepo.getCardCalendar(cardId)
  const automatic = statementPeriodFor(calendar, date)
  return [0, 1, 2].map((offset) => statementDates(calendar, shiftMonth(automatic, offset)))
}

/** `null` when the card doesn't exist (e.g. a stale URL). */
export async function getOpenPeriod(cardId: string, today: DateStamp = todayStamp()): Promise<MonthStamp | null> {
  if (!(await creditCardsRepo.getCreditCard(cardId))) return null
  return statementPeriodFor(await creditCardsRepo.getCardCalendar(cardId), today)
}

function parseDay(value: string): number {
  return Number.parseInt(value, 10)
}

export async function createCardFromForm(values: CardFormValues): Promise<CreditCard> {
  return creditCardsRepo.createCreditCard({
    name: values.name,
    closingDay: parseDay(values.closingDay),
    dueDay: parseDay(values.dueDay),
    ...(values.notes && { notes: values.notes }),
  })
}

/** Returns how many gastos moved to another statement. */
export async function updateCardFromForm(id: string, values: CardFormValues): Promise<number> {
  return creditCardsRepo.updateCreditCard(id, {
    name: values.name,
    closingDay: parseDay(values.closingDay),
    dueDay: parseDay(values.dueDay),
    notes: values.notes || undefined,
  })
}

/** Returns how many gastos moved to another statement. */
export async function correctStatementDates(cardId: string, period: MonthStamp, values: StatementDatesFormValues): Promise<number> {
  return cardStatementsRepo.setStatementOverride({ cardId, period, closeDate: values.closeDate, dueDate: values.dueDate })
}

export async function resetStatementDates(cardId: string, period: MonthStamp): Promise<number> {
  return cardStatementsRepo.removeStatementOverride(cardId, period)
}

/**
 * Pays the statement in full from the form: one line per currency of the
 * totals the user was shown. Each debited amount is parsed in the currency
 * the form showed for its account; in the statement's own currency the
 * account is debited exactly the total, so nothing is asked. The
 * repository re-reads the totals and rejects if they changed since.
 */
export async function payStatementFromForm(
  cardId: string,
  period: MonthStamp,
  values: PaymentFormValues,
  shown: { totals: readonly Money[]; accountCurrency: ReadonlyMap<string, string> },
): Promise<void> {
  const lines = await Promise.all(
    values.lines.map(async (line) => {
      const total = shown.totals.find((t) => t.currency === line.currency)
      invariant(total, `El resumen no tiene saldo en ${line.currency}`)
      const account = await accountsRepo.getAccount(line.accountId)
      invariant(account, `Cuenta no encontrada: ${line.accountId}`)
      const accountCurrency = shown.accountCurrency.get(account.id) ?? account.currency
      if (accountCurrency === line.currency) {
        return { currency: line.currency, expectedAmount: total.amount, accountId: account.id, expectedAccountCurrency: accountCurrency }
      }
      invariant(line.debitedAmount.trim() !== '', `Ingresá cuánto se debitó en ${accountCurrency}`)
      const debited = parseAmount(line.debitedAmount, accountCurrency).amount
      invariant(debited > 0, 'El monto debitado tiene que ser mayor a cero')
      return {
        currency: line.currency,
        expectedAmount: total.amount,
        accountId: account.id,
        debitedAmount: debited,
        expectedAccountCurrency: accountCurrency,
      }
    }),
  )
  await statementPaymentsRepo.payStatement({ cardId, period, date: values.date, lines })
}

/** Returns how many payments were removed — 0 if another tab already
 *  undid it. */
export async function undoStatementPayment(cardId: string, period: MonthStamp): Promise<number> {
  return statementPaymentsRepo.undoStatementPayment(cardId, period)
}

export const RECONCILE_DESCRIPTION = 'Cargos del resumen (diferencia con el banco)'

/** The currencies reconciliation asks the bank's total for: the
 *  statement's own, plus ARS and USD — an Argentine statement bills both,
 *  even when Moneta has nothing loaded in one of them yet. */
export function reconcileCurrencies(totals: readonly Money[]): string[] {
  return [...new Set([...totals.map((t) => t.currency), 'ARS', 'USD'])]
}

/** Bank totals typed so far, parsed — a blank or unreadable line is left
 *  out (not compared). For the live preview and the save alike. */
export function parseBankTotals(lines: ReconcileFormValues['lines']): Money[] {
  return lines.flatMap((line) => {
    const parsed = tryParseAmount(line.bankTotal, line.currency)
    return parsed ? [parsed] : []
  })
}

/**
 * Registers, as a gasto of the statement, every currency where the bank
 * billed more than Moneta's total — against the totals the user was shown
 * (the repository re-reads them and rejects if they changed).
 */
export async function reconcileStatementFromForm(
  cardId: string,
  period: MonthStamp,
  values: ReconcileFormValues,
  shownTotals: readonly Money[],
): Promise<number> {
  const bankTotals = parseBankTotals(values.lines)
  const differences = statementDifferences(shownTotals, bankTotals)
  const lines = bankTotals.flatMap((bank, i) =>
    (differences[i]?.amount ?? 0) > 0
      ? [
          {
            currency: bank.currency,
            bankTotal: bank.amount,
            expectedTotal: shownTotals.find((t) => t.currency === bank.currency)?.amount ?? 0,
          },
        ]
      : [],
  )
  invariant(lines.length > 0, 'No hay diferencias a favor del banco para registrar')
  invariant(values.categoryId !== '', 'Elegí una categoría para la diferencia')
  return cardStatementsRepo.addStatementDifferences({
    cardId,
    period,
    categoryId: values.categoryId,
    description: values.description.trim() || RECONCILE_DESCRIPTION,
    lines,
  })
}

export function listExpenseCategories() {
  return categoriesRepo.listActiveCategories('expense')
}
