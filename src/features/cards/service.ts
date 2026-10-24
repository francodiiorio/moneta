import { cardStatementsRepo, categoriesRepo, creditCardsRepo } from '@/database/repositories'
import {
  openStatement,
  statementDates,
  statementPeriodFor,
  statementTotals,
  type CardCalendar,
  type StatementDates,
} from '@/domain/cards'
import type { CreditCard, Expense } from '@/domain/entities'
import { money, type Money } from '@/domain/money'
import { daysBetween, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import type { CardFormValues, StatementDatesFormValues } from './schema'

export { setCreditCardArchived, deleteCreditCard, listCreditCards } from '@/database/repositories/creditCards.repo'

export type StatementStatus = 'open' | 'closed' | 'upcoming'

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
}

function statusOf(calendar: CardCalendar, period: MonthStamp, today: DateStamp): StatementStatus {
  const open = statementPeriodFor(calendar, today)
  if (period === open) return 'open'
  return period < open ? 'closed' : 'upcoming'
}

function buildView(
  calendar: CardCalendar,
  period: MonthStamp,
  expenses: readonly Expense[],
  today: DateStamp,
): StatementView {
  const dates = statementDates(calendar, period)
  return {
    ...dates,
    isCorrected: calendar.overrides.some((o) => o.period === period),
    status: statusOf(calendar, period, today),
    totals: statementTotals(expenses),
    expenseCount: expenses.length,
    projectedCount: expenses.filter((e) => e.status === 'projected').length,
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
      const [currentExpenses, previousExpenses] = await Promise.all([
        cardStatementsRepo.listCardExpenses(card.id, open.period),
        cardStatementsRepo.listCardExpenses(card.id, previousPeriod),
      ])
      const current = buildView(calendar, open.period, currentExpenses, today)
      const previous = buildView(calendar, previousPeriod, previousExpenses, today)
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

export interface StatementDetail extends StatementView {
  card: CreditCard
  expenses: StatementExpenseRow[]
}

export async function getStatementDetail(
  cardId: string,
  period: MonthStamp,
  today: DateStamp = todayStamp(),
): Promise<StatementDetail | undefined> {
  const card = await creditCardsRepo.getCreditCard(cardId)
  if (!card) return undefined
  const [calendar, expenses, categories] = await Promise.all([
    creditCardsRepo.getCardCalendar(cardId),
    cardStatementsRepo.listCardExpenses(cardId, period),
    categoriesRepo.listCategories(),
  ])
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const view = buildView(calendar, period, expenses, today)
  return {
    ...view,
    card,
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
