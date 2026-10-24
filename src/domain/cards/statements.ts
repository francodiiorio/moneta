import type { CardStatement, CreditCard, Expense } from '@/domain/entities'
import { money, sumMoney, type Money } from '@/domain/money'
import {
  dayOfMonth,
  formatMonthLabel,
  isValidDateStamp,
  monthOf,
  monthRange,
  shiftMonth,
  type DateStamp,
  type MonthStamp,
} from '@/lib/dates'

/** A card's closing/due days plus the periods whose real dates were
 *  corrected by hand — everything needed to place a purchase in its
 *  statement. */
export interface CardCalendar {
  card: Pick<CreditCard, 'closingDay' | 'dueDay'>
  overrides: readonly Pick<CardStatement, 'period' | 'closeDate' | 'dueDate'>[]
}

export interface StatementDates {
  period: MonthStamp
  closeDate: DateStamp
  dueDate: DateStamp
}

/**
 * The close/due dates of `period` (the month the statement closes in):
 * the hand-corrected ones if that period has an override, else the card's
 * default days. The default due date is the first `dueDay` after the
 * close — the same month if it comes later in the month ("cierra el 5,
 * vence el 15"), else the next one ("cierra el 25, vence el 5").
 */
export function statementDates(calendar: CardCalendar, period: MonthStamp): StatementDates {
  const override = calendar.overrides.find((o) => o.period === period)
  if (override) return { period, closeDate: override.closeDate, dueDate: override.dueDate }

  const { closingDay, dueDay } = calendar.card
  const closeDate = dayOfMonth(period, closingDay)
  const sameMonthDue = dayOfMonth(period, dueDay)
  const dueDate = sameMonthDue > closeDate ? sameMonthDue : dayOfMonth(shiftMonth(period, 1), dueDay)
  return { period, closeDate, dueDate }
}

/**
 * The statement a purchase on `date` falls into: the first period whose
 * close is on or after `date` (a purchase on the closing day itself goes
 * into that statement). Starts one month early: an override can move a
 * period's close into the next month ("septiembre cerró el 2 de
 * octubre"), and a purchase on Oct 1st then belongs to September.
 */
export function statementPeriodFor(calendar: CardCalendar, date: DateStamp): MonthStamp {
  let period = shiftMonth(monthOf(date), -1)
  // A close always lands within a couple of months of its period, so this
  // finds it on the 1st–3rd try; the bound only guards absurd overrides.
  for (let i = 0; i < 4; i++) {
    if (date <= statementDates(calendar, period).closeDate) return period
    period = shiftMonth(period, 1)
  }
  return period
}

/** The statement still open on `today` — the one new purchases go into. */
export function openStatement(calendar: CardCalendar, today: DateStamp): StatementDates {
  return statementDates(calendar, statementPeriodFor(calendar, today))
}

/**
 * What a statement adds up to, one Money per currency — a card statement
 * carries ARS and USD balances separately and never converts between
 * them. Sorted by currency so the order is stable.
 */
export function statementTotals(expenses: readonly Pick<Expense, 'amount' | 'currency'>[]): Money[] {
  const byCurrency = new Map<string, Money[]>()
  for (const expense of expenses) {
    const list = byCurrency.get(expense.currency) ?? []
    list.push(money(expense.amount, expense.currency))
    byCurrency.set(expense.currency, list)
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amounts]) => sumMoney(currency, amounts))
}

/**
 * After a period's dates change (an override added, edited or removed),
 * which of `expenses` (one card's) move to another statement. Only the
 * ones that were where automatic placement put them under the OLD
 * calendar get re-placed with the new one; an expense the user moved by
 * hand (a late presentation, an installment pinned to its statement)
 * isn't in its automatic period, so it's left alone.
 */
export function reassignedPeriods(
  expenses: readonly Pick<Expense, 'id' | 'date' | 'statementPeriod'>[],
  before: CardCalendar,
  after: CardCalendar,
): { id: string; statementPeriod: MonthStamp }[] {
  const moves: { id: string; statementPeriod: MonthStamp }[] = []
  for (const expense of expenses) {
    if (expense.statementPeriod === undefined) continue
    if (expense.statementPeriod !== statementPeriodFor(before, expense.date)) continue
    const next = statementPeriodFor(after, expense.date)
    if (next !== expense.statementPeriod) moves.push({ id: expense.id, statementPeriod: next })
  }
  return moves
}

/**
 * Why `period` can't close on `closeDate` / be due on `dueDate`, or
 * `undefined` if it can. `statementPeriodFor` relies on two things every
 * calendar must keep: a period closes within its own month or the next
 * one (its search starts one month early), and closes are strictly
 * increasing. A mistyped year or month would otherwise silently re-place
 * every automatic purchase around it. Checked against the calendar AS IT
 * WOULD BE with this override (its neighbours' real dates included).
 * Messages are user-facing (Spanish).
 */
export function statementOverrideProblem(
  calendar: CardCalendar,
  period: MonthStamp,
  closeDate: DateStamp,
  dueDate: DateStamp,
): string | undefined {
  if (!isValidDateStamp(closeDate) || !isValidDateStamp(dueDate)) return 'Fecha inválida'
  if (dueDate < closeDate) return 'El vencimiento no puede ser anterior al cierre'
  const earliest = monthRange(period).start
  const latest = monthRange(shiftMonth(period, 1)).end
  if (closeDate < earliest || closeDate > latest) {
    return `El cierre del resumen de ${formatMonthLabel(period).toLowerCase()} tiene que caer en ese mes o en el siguiente`
  }
  const others = calendar.overrides.filter((o) => o.period !== period)
  const withOverride: CardCalendar = { ...calendar, overrides: [...others, { period, closeDate, dueDate }] }
  const previousClose = statementDates(withOverride, shiftMonth(period, -1)).closeDate
  const nextClose = statementDates(withOverride, shiftMonth(period, 1)).closeDate
  if (closeDate <= previousClose || closeDate >= nextClose) {
    return 'El cierre tiene que quedar después del cierre del resumen anterior y antes del siguiente'
  }
  return undefined
}
