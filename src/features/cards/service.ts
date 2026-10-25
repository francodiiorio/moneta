import {
  accountsRepo,
  cardStatementsRepo,
  categoriesRepo,
  creditCardsRepo,
  statementPaymentsRepo,
} from '@/database/repositories'
import {
  openingBalanceOf,
  openStatement,
  statementDates,
  statementDifferences,
  statementPaymentState,
  statementPeriodFor,
  statementBalance,
  type CardCalendar,
  type StatementDates,
  type StatementPaymentState,
} from '@/domain/cards'
import type { CreditCard, Expense, StatementPayment } from '@/domain/entities'
import { formatAmountInput, money, parseAmount, tryParseAmount, type Money } from '@/domain/money'
import { daysBetween, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type { CardFormValues, PaymentFormValues, ReconcileFormValues, StatementDatesFormValues } from './schema'

export { setCreditCardArchived, deleteCreditCard, listCreditCards } from '@/database/repositories/creditCards.repo'
export { listAccounts } from '@/database/repositories/accounts.repo'

export type StatementStatus = 'open' | 'closed' | 'upcoming'

/** Where a statement stands on being paid: nothing to pay ('empty'),
 *  paid ('paid'), paid with a difference against Moneta's total
 *  ('mismatch'), or with some currency still unpaid — before its due date
 *  ('pending') or past it ('overdue').
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
  /** Currencies of the total with no payment yet (paid on their own). */
  unpaidCurrencies: string[]
  /** What's still to pay: the totals of `unpaidCurrencies`. */
  owed: Money[]
  due: DueState
}

function statusOf(calendar: CardCalendar, period: MonthStamp, today: DateStamp): StatementStatus {
  const open = statementPeriodFor(calendar, today)
  if (period === open) return 'open'
  return period < open ? 'closed' : 'upcoming'
}

/** The currencies of `totals` with nothing paid yet — each currency is
 *  paid on its own (pesos and dollars often on different days). */
function unpaidCurrenciesOf(totals: readonly Money[], payments: readonly StatementPayment[]): string[] {
  const paid = new Set(payments.map((p) => p.currency))
  return totals.filter((t) => t.amount > 0 && !paid.has(t.currency)).map((t) => t.currency)
}

function dueStateOf(
  calendar: CardCalendar,
  period: MonthStamp,
  payment: StatementPaymentState,
  totals: readonly Money[],
  unpaidCurrencies: readonly string[],
  hasPayments: boolean,
  dueDate: DateStamp,
  today: DateStamp,
): DueState {
  if (payment.status === 'paid') return 'paid'
  // Something paid, every currency with a payment: a difference to look at.
  if (hasPayments && unpaidCurrencies.length === 0) return 'mismatch'
  if (totals.length === 0 && !hasPayments) return 'empty'
  if (today <= dueDate) return 'pending'
  const lastClosed = shiftMonth(statementPeriodFor(calendar, today), -1)
  // An old unpaid statement was most likely paid before Moneta — not one
  // with an opening balance (declared as owed) nor a partly paid one.
  const hasOpening = openingBalanceOf(calendar, period).length > 0
  return period < lastClosed && !hasOpening && !hasPayments ? 'unrecorded' : 'overdue'
}

function buildView(
  calendar: CardCalendar,
  period: MonthStamp,
  expenses: readonly Expense[],
  payments: readonly StatementPayment[],
  today: DateStamp,
): StatementView {
  const dates = statementDates(calendar, period)
  const totals = statementBalance(calendar, period, expenses)
  const payment = statementPaymentState(totals, payments)
  const unpaidCurrencies = unpaidCurrenciesOf(totals, payments)
  return {
    ...dates,
    isCorrected: calendar.overrides.some((o) => o.period === period),
    status: statusOf(calendar, period, today),
    totals,
    expenseCount: expenses.length,
    projectedCount: expenses.filter((e) => e.status === 'projected').length,
    payment,
    unpaidCurrencies,
    owed: totals.filter((t) => unpaidCurrencies.includes(t.currency)),
    due: dueStateOf(calendar, period, payment, totals, unpaidCurrencies, payments.length > 0, dates.dueDate, today),
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
  /** What was owed here before Moneta (CreditCard.openingBalances) — part
   *  of `totals`, shown as its own line. Empty for most statements. */
  openingBalance: Money[]
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
    openingBalance: openingBalanceOf(calendar, period),
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

/** The form's four opening-balance fields: which statement (the closed
 *  one, or the one open when the card was added) and currency each is. */
const OPENING_FIELDS = [
  { field: 'openingClosedArs', offset: 0, currency: 'ARS' },
  { field: 'openingClosedUsd', offset: 0, currency: 'USD' },
  { field: 'openingOpenArs', offset: 1, currency: 'ARS' },
  { field: 'openingOpenUsd', offset: 1, currency: 'USD' },
] as const

type OpeningField = (typeof OPENING_FIELDS)[number]['field']

/**
 * The closed statement the opening balance's "closed" fields refer to (the
 * "open" ones are the month after): the one it was entered for, if the
 * card has one, else the statement closed today by the card's calendar.
 */
export function openingBasePeriod(
  calendar: CardCalendar & { card: Pick<CreditCard, 'openingBase'> },
  today: DateStamp = todayStamp(),
): MonthStamp {
  return calendar.card.openingBase ?? shiftMonth(statementPeriodFor(calendar, today), -1)
}

/** The opening balance as the form shows it (blank where there's none). */
export function openingFormValues(card: CreditCard): Record<OpeningField, string> {
  const base = openingBasePeriod({ card, overrides: [] })
  const values = { openingClosedArs: '', openingClosedUsd: '', openingOpenArs: '', openingOpenUsd: '' }
  for (const { field, offset, currency } of OPENING_FIELDS) {
    const entry = card.openingBalances?.find((b) => b.period === shiftMonth(base, offset) && b.currency === currency)
    if (entry) values[field] = formatAmountInput(money(entry.amount, entry.currency))
  }
  return values
}

/** The form's fields as the card's opening balance — plus any entry the
 *  form can't show (another currency, from a backup), kept as it was. */
function openingBalancesFrom(
  values: CardFormValues,
  base: MonthStamp,
  existing: CreditCard['openingBalances'] = [],
): NonNullable<CreditCard['openingBalances']> {
  const shown = new Set(OPENING_FIELDS.map(({ offset, currency }) => `${shiftMonth(base, offset)}:${currency}`))
  const fromForm = OPENING_FIELDS.flatMap(({ field, offset, currency }) => {
    const text = values[field]
    if (text.trim() === '') return []
    const amount = parseAmount(text, currency).amount
    invariant(amount > 0, 'El saldo inicial tiene que ser mayor a cero')
    return [{ period: shiftMonth(base, offset), currency, amount }]
  })
  return [...existing.filter((b) => !shown.has(`${b.period}:${b.currency}`)), ...fromForm]
}

function daysOf(values: CardFormValues) {
  return {
    closingDay: parseDay(values.closingDay),
    dueDay: parseDay(values.dueDay),
    closingDayToNext: values.closingDayToNext,
  }
}

export async function createCardFromForm(values: CardFormValues, today: DateStamp = todayStamp()): Promise<CreditCard> {
  const days = daysOf(values)
  const base = openingBasePeriod({ card: days, overrides: [] }, today)
  return creditCardsRepo.createCreditCard({
    name: values.name,
    ...days,
    openingBalances: openingBalancesFrom(values, base),
    openingBase: base,
    ...(values.notes && { notes: values.notes }),
  })
}

/** Returns how many gastos moved to another statement. */
export async function updateCardFromForm(id: string, values: CardFormValues, today: DateStamp = todayStamp()): Promise<number> {
  const calendar = await creditCardsRepo.getCardCalendar(id)
  const days = daysOf(values)
  // The statements an existing opening balance was entered for; else the
  // one closed today — by the card's new days and its corrected dates.
  const base = openingBasePeriod({ card: { ...calendar.card, ...days }, overrides: calendar.overrides }, today)
  return creditCardsRepo.updateCreditCard(id, {
    name: values.name,
    ...days,
    openingBalances: openingBalancesFrom(values, base, calendar.card.openingBalances),
    openingBase: base,
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
 * Pays the statement from the form: one line per currency with something
 * paid (a blank amount skips it), by what the bank charged — Moneta's
 * total may differ, and the statement then shows the difference. Each
 * debited amount is parsed in the currency the form showed for its
 * account; in the statement's own currency the debit is the amount paid.
 */
export async function payStatementFromForm(
  cardId: string,
  period: MonthStamp,
  values: PaymentFormValues,
  shown: { accountCurrency: ReadonlyMap<string, string> },
): Promise<void> {
  const filled = values.lines.filter((line) => line.paidAmount.trim() !== '')
  invariant(filled.length > 0, 'Cargá lo que pagaste en al menos una moneda')
  const lines = await Promise.all(
    filled.map(async (line) => {
      const amount = parseAmount(line.paidAmount, line.currency).amount
      invariant(amount > 0, 'Lo pagado tiene que ser mayor a cero')
      const account = await accountsRepo.getAccount(line.accountId)
      invariant(account, `Cuenta no encontrada: ${line.accountId}`)
      const accountCurrency = shown.accountCurrency.get(account.id) ?? account.currency
      if (accountCurrency === line.currency) {
        return { currency: line.currency, amount, accountId: account.id, expectedAccountCurrency: accountCurrency }
      }
      invariant(line.debitedAmount.trim() !== '', `Ingresá cuánto se debitó en ${accountCurrency}`)
      const debited = parseAmount(line.debitedAmount, accountCurrency).amount
      invariant(debited > 0, 'El monto debitado tiene que ser mayor a cero')
      return { currency: line.currency, amount, accountId: account.id, debitedAmount: debited, expectedAccountCurrency: accountCurrency }
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
