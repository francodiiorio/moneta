import {
  accountsRepo,
  budgetsRepo,
  cardStatementsRepo,
  categoriesRepo,
  creditCardsRepo,
  exchangeRatesRepo,
  expensesRepo,
  incomesRepo,
  installmentPlansRepo,
  investmentsRepo,
  recurringPlansRepo,
  savingsHoldingsRepo,
  settingsRepo,
} from '@/database/repositories'
import { generateOccurrences, pendingOccurrencesInRange } from '@/domain/recurrence'
import { lastPurchaseDay, statementBalance, statementDates } from '@/domain/cards'
import { groupSpending, monthLeft, spendingObservations, type SpendingEntry, type SpendingObservation } from '@/domain/cashflow'
import { convert, MissingRateError } from '@/domain/currency'
import { formatMoney, money, percentChange, sumMoney, type Money } from '@/domain/money'
import { addDays, currentMonthStamp, dayOfMonth, monthOf, monthRange, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import type { CalendarEvent } from '@/lib/ics'
// Another feature's service, never its components — see docs/DECISIONS.md
// "Un feature puede importar el service.ts/hooks de otro".
import { listTransactionsForMonth, type TransactionListItem } from '@/features/transactions/service'
import { listCardSummaries } from '@/features/cards/service'
import type { MonthSummary } from '@/features/reports/service'

/** Per-browser convenience, not data: whether the user closed "Primeros
 *  pasos". Cleared by "Borrar todos los datos" (features/settings). */
export const ONBOARDING_HIDDEN_KEY = 'moneta-onboarding-hidden'

export function clearOnboardingHidden(): void {
  try {
    localStorage.removeItem(ONBOARDING_HIDDEN_KEY)
  } catch {
    // Storage blocked: nothing was saved there either.
  }
}

export type OnboardingStepId = 'account' | 'card' | 'expense' | 'income' | 'budget'

export interface OnboardingStep {
  id: OnboardingStepId
  done: boolean
}

export interface Onboarding {
  steps: OnboardingStep[]
  /** Anything loaded at all — an account, a card, a movement, savings or
   *  an investment: until then the home is a welcome, not a dashboard of
   *  zeros. (Default categories and settings don't count: every install
   *  has them.) */
  hasData: boolean
}

/** "Primeros pasos": each step ticks itself off from what's really stored. */
export async function getOnboarding(): Promise<Onboarding> {
  const [accounts, cards, expenseCount, incomeCount, budgets, savings, holdings, recurring] = await Promise.all([
    accountsRepo.listAccounts(),
    creditCardsRepo.listCreditCards(),
    expensesRepo.countExpenses(),
    incomesRepo.countIncomes(),
    budgetsRepo.listBudgets(),
    savingsHoldingsRepo.listSavingsHoldings(),
    investmentsRepo.listInvestmentHoldings(),
    recurringPlansRepo.listRecurringPlans(),
  ])
  return {
    steps: [
      { id: 'account', done: accounts.length > 0 },
      { id: 'card', done: cards.length > 0 },
      { id: 'expense', done: expenseCount > 0 },
      { id: 'income', done: incomeCount > 0 },
      { id: 'budget', done: budgets.length > 0 },
    ],
    hasData:
      accounts.length +
        cards.length +
        expenseCount +
        incomeCount +
        savings.length +
        holdings.length +
        // A recurring plan starting later has no gasto yet, but "se viene" shows it.
        recurring.length >
      0,
  }
}

export interface UpcomingItem {
  /** Stable across renders: an expense id, or plan id + date. */
  key: string
  date: DateStamp
  description: string
  amount: Money
  /** 'income': a salary coming in, not a payment. */
  kind: 'installment' | 'recurring' | 'income'
  categoryColor?: string
  categoryIcon?: string
}

/**
 * What's coming in the next `days` days — a full month by default, so a
 * monthly payment on today's day of the month next month is included: installments already projected
 * (each cuota is stored ahead as a `projected` gasto) and the occurrences
 * of active recurring plans — those are only materialized when due, so
 * they're computed from the rule, from the first one not materialized yet.
 */
export async function getUpcoming(today: DateStamp = todayStamp(), days = 31): Promise<UpcomingItem[]> {
  const end = addDays(today, days)
  const [expenses, plans, categories] = await Promise.all([
    expensesRepo.listExpensesInRange(today, end),
    recurringPlansRepo.listRecurringPlans(),
    categoriesRepo.listCategories(),
  ])
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const decorate = (categoryId: string) => {
    const category = categoryById.get(categoryId)
    return {
      ...(category?.color !== undefined && { categoryColor: category.color }),
      ...(category?.icon !== undefined && { categoryIcon: category.icon }),
    }
  }

  const installments: UpcomingItem[] = expenses
    .filter((e) => e.status === 'projected')
    .map((e) => ({
      key: e.id,
      date: e.date,
      description: e.description,
      amount: money(e.amount, e.currency),
      kind: 'installment',
      ...decorate(e.categoryId),
    }))
  const recurring: UpcomingItem[] = plans
    .filter((p) => !p.isPaused)
    .flatMap((plan) =>
      generateOccurrences(plan.rule, end)
        // Not yet materialized — the same watermark materializeDue uses: if
        // the app stayed open past midnight, today's occurrence is still
        // to come; one a merged backup already materialized is not.
        .filter((date) => date >= today && date > (plan.lastMaterializedDate ?? ''))
        .map((date) => ({
          key: `${plan.id}:${date}`,
          date,
          description: plan.template.description,
          amount: money(plan.template.amount, plan.template.currency),
          kind: plan.kind === 'income' ? ('income' as const) : ('recurring' as const),
          ...decorate(plan.template.categoryId),
        })),
    )
  return [...installments, ...recurring].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
}

/** The latest confirmed movements of this month and the last one — enough
 *  to fill the list early in a month too. Newest first. */
export async function getRecentMovements(
  limit = 5,
  month = currentMonthStamp(),
  today: DateStamp = todayStamp(),
): Promise<TransactionListItem[]> {
  const [current, previous] = await Promise.all([
    listTransactionsForMonth(month),
    listTransactionsForMonth(shiftMonth(month, -1)),
  ])
  // A gasto loaded ahead with a later date isn't "recent" yet.
  return [...current, ...previous].filter((item) => item.status === 'confirmed' && item.date <= today).slice(0, limit)
}

/** Share of the month's ingresos left after gastos (0..1, negative when
 *  the month cost more than came in) — a display ratio, computed here so
 *  no component divides Minor amounts. `undefined` without ingresos. */
export function savingsRate(summary: Pick<MonthSummary, 'income' | 'net'>): number | undefined {
  if (summary.income.amount <= 0) return undefined
  return summary.net.amount / summary.income.amount
}

/** Month-over-month change of a gasto or ingreso total, for a KPI.
 *  `undefined` when there's nothing to compare against, when either month
 *  is partial (a missing exchange rate would make the change meaningless:
 *  "+300%" from an unconverted ingreso), or for a moment right after the
 *  base currency changes, when one month may still arrive in the old one. */
export function monthChange(
  previous: { total: Money; missingRateCount: number },
  current: { total: Money; missingRateCount: number },
): number | undefined {
  if (previous.missingRateCount > 0 || current.missingRateCount > 0) return undefined
  if (previous.total.currency !== current.total.currency) return undefined
  return percentChange(previous.total, current.total)
}

export interface MonthLeftCard {
  cardId: string
  cardName: string
  dueDate: DateStamp
  amount: Money
  /** Part of the statement is in a currency without a rate (left out). */
  missingRate: boolean
}

/** "¿Cuánto me queda?" for one month, in the base currency. */
export interface MonthLeft {
  income: Money
  fixed: Money
  cards: Money
  other: Money
  left: Money
  /** Each card statement due this month, what it adds up to. */
  cardItems: MonthLeftCard[]
  /** Whether any ingreso counts — without one "te queda" means little.
   *  Counted, not converted: a salary without a rate is still there. */
  hasIncome: boolean
  /** Amounts left out for lack of an exchange rate. */
  missingRateCount: number
}

/**
 * The month's money as it moves through the accounts: ingresos (received
 * and a salary still to come) against the fixed gastos not paid by card,
 * the card statements due this month (whole — purchases are counted once,
 * through their statement, never on their own dates) and every other
 * gasto not paid by card (debit, cash, a loan's cuota, projected ones
 * included). A statement also counts the card's fixed gastos still to be
 * generated in its purchase window, as it already does projected cuotas.
 * Archived cards count too: their last statements are still due.
 * Converted to the base currency at each amount's date.
 */
export async function getMonthLeft(month: MonthStamp): Promise<MonthLeft> {
  const { start, end } = monthRange(month)
  const [expenses, incomes, plans, cards, settings, rates] = await Promise.all([
    expensesRepo.listExpensesInRange(start, end),
    incomesRepo.listIncomesInRange(start, end),
    recurringPlansRepo.listRecurringPlans(),
    creditCardsRepo.listCreditCards(),
    settingsRepo.getSettings(),
    exchangeRatesRepo.listExchangeRates(),
  ])
  const base = settings.baseCurrency
  let missingRateCount = 0
  function inBase(amount: Money, date: DateStamp): Money {
    try {
      return convert(amount, base, rates, date, settings.rateProfile)
    } catch (error) {
      if (!(error instanceof MissingRateError)) throw error
      missingRateCount += 1
      return money(0, base)
    }
  }
  const total = (items: readonly { amount: Money; date: DateStamp }[]) =>
    sumMoney(base, items.map((i) => inBase(i.amount, i.date)))

  const recurringIds = new Set(plans.map((p) => p.id))
  const active = plans.filter((p) => !p.isPaused)
  const upcoming = (kind: 'income' | 'expense') =>
    active
      .filter((p) => (p.kind ?? 'expense') === kind && p.template.cardId === undefined)
      .flatMap((p) =>
        pendingOccurrencesInRange(p.rule, p.lastMaterializedDate, start, end).map((date) => ({
          amount: money(p.template.amount, p.template.currency),
          date,
        })),
      )
  const notByCard = expenses.filter((e) => e.cardId === undefined)
  const asItem = (e: { amount: number; currency: string; date: DateStamp }) => ({ amount: money(e.amount, e.currency), date: e.date })

  const incomeItems = [...incomes.map(asItem), ...upcoming('income')]
  const income = total(incomeItems)
  const fixed = total([
    ...notByCard.filter((e) => e.sourcePlanId !== undefined && recurringIds.has(e.sourcePlanId)).map(asItem),
    ...upcoming('expense'),
  ])
  const other = total(notByCard.filter((e) => e.sourcePlanId === undefined || !recurringIds.has(e.sourcePlanId)).map(asItem))

  // A statement due this month closed this month or up to two earlier
  // (an override's close stays within a month of its period).
  const cardItems: MonthLeftCard[] = []
  for (const card of cards) {
    const calendar = await creditCardsRepo.getCardCalendar(card.id)
    const cardPlans = active.filter((p) => (p.kind ?? 'expense') === 'expense' && p.template.cardId === card.id)
    for (const period of [shiftMonth(month, -2), shiftMonth(month, -1), month]) {
      const { dueDate } = statementDates(calendar, period)
      if (dueDate < start || dueDate > end) continue
      const from = addDays(lastPurchaseDay(calendar, shiftMonth(period, -1)), 1)
      const to = lastPurchaseDay(calendar, period)
      const pending = cardPlans.flatMap((p) =>
        pendingOccurrencesInRange(p.rule, p.lastMaterializedDate, from, to).map(() => ({
          amount: p.template.amount,
          currency: p.template.currency,
        })),
      )
      const totals = statementBalance(calendar, period, [...(await cardStatementsRepo.listCardExpenses(card.id, period)), ...pending])
      if (totals.length === 0) continue
      const missedBefore = missingRateCount
      const amount = total(totals.map((t) => ({ amount: t, date: dueDate })))
      cardItems.push({ cardId: card.id, cardName: card.name, dueDate, amount, missingRate: missingRateCount > missedBefore })
    }
  }
  cardItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const cardsTotal = sumMoney(base, cardItems.map((c) => c.amount))

  return {
    income,
    fixed,
    cards: cardsTotal,
    other,
    left: monthLeft({ income, fixed, cards: cardsTotal, other }),
    cardItems,
    hasIncome: incomeItems.length > 0,
    missingRateCount,
  }
}


/** What changed in how the month is going, by merchant and category. */
export interface MonthObservations {
  /** The month is still running: compared up to today against the same
   *  days of the previous one, not against the whole of it. */
  toDate: boolean
  items: SpendingObservation[]
}

/** Before this day of a running month, a couple of days against a couple
 *  of days: one delivery more or less reads as "80% menos". */
export const OBSERVATIONS_FROM_DAY = 7

/**
 * At most three changes against the previous month worth pointing out
 * (see domain/cashflow `spendingObservations`), in the base currency at
 * each purchase's date. What was bought, not what was paid: a purchase in
 * cuotas counts whole on its purchase date (its cuotas don't), and gastos
 * fijos don't count — they say nothing new about the month. Nothing while
 * the previous period isn't fully loaded (the first month of use): against
 * a few days of it everything reads "+300%".
 */
export async function getMonthObservations(month: MonthStamp, today: DateStamp = todayStamp()): Promise<MonthObservations> {
  const thisMonth = monthOf(today)
  const toDate = month === thisMonth
  const day = Number(today.slice(8))
  if (month > thisMonth || (toDate && day < OBSERVATIONS_FROM_DAY)) return { toDate, items: [] }
  const previousMonth = shiftMonth(month, -1)
  const current = { start: monthRange(month).start, end: toDate ? today : monthRange(month).end }
  const previous = {
    start: monthRange(previousMonth).start,
    end: toDate ? dayOfMonth(previousMonth, day) : monthRange(previousMonth).end,
  }
  const [firstDate, expenses, installmentPlans, categories, settings, rates] = await Promise.all([
    expensesRepo.firstExpenseDate(),
    expensesRepo.listExpensesInRange(previous.start, current.end),
    installmentPlansRepo.listInstallmentPlans(),
    categoriesRepo.listCategories(),
    settingsRepo.getSettings(),
    exchangeRatesRepo.listExchangeRates(),
  ])
  if (firstDate === undefined || firstDate > previous.start) return { toDate, items: [] }
  const base = settings.baseCurrency
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const purchases = [
    ...expenses.filter((e) => e.status === 'confirmed' && e.sourcePlanId === undefined),
    ...installmentPlans.map((p) => ({ ...p, date: p.purchaseDate, amount: p.totalAmount })),
  ]
  const entries: SpendingEntry[] = []
  for (const purchase of purchases) {
    const inCurrent = purchase.date >= current.start && purchase.date <= current.end
    const inPrevious = purchase.date >= previous.start && purchase.date <= previous.end
    if (!inCurrent && !inPrevious) continue
    let amount: Money | undefined
    try {
      amount = convert(money(purchase.amount, purchase.currency), base, rates, purchase.date, settings.rateProfile)
    } catch (error) {
      if (!(error instanceof MissingRateError)) throw error
    }
    const category = categoryById.get(purchase.categoryId)
    entries.push({
      period: inCurrent ? 'current' : 'previous',
      date: purchase.date,
      description: purchase.description,
      amount,
      ...(category && { category: { id: category.id, name: category.name } }),
    })
  }
  const { pairs, previousTotal } = groupSpending(entries, base)
  return { toDate, items: spendingObservations(pairs, previousTotal) }
}

export interface CalendarExportOptions {
  /** Each card's closes and due dates. */
  cards: boolean
  /** Fixed gastos and cuotas not paid by card (by card they're in the
   *  statement). */
  fixed: boolean
  /** Amounts in the event titles — off by default: a calendar is often
   *  synced to someone else's cloud. */
  amounts: boolean
}

const DAY_BEFORE = { daysBefore: 1, hour: 10 }

/**
 * The payments ahead, as calendar events through the next `months`
 * months: the closed statement still to pay (with what's owed, if any is
 * loaded), then each card's closes and due dates — without an amount, it
 * isn't known yet —, and the fixed gastos and cuotas not paid by card.
 * An archived card only keeps its last statement's due date, if owed;
 * paused plans are left out. Ids are stable (card + period, plan + date),
 * and a last event near the horizon asks to download it again.
 */
export async function getCalendarEvents(
  options: CalendarExportOptions,
  today: DateStamp = todayStamp(),
  months = 12,
): Promise<CalendarEvent[]> {
  const until = monthRange(shiftMonth(monthOf(today), months - 1)).end
  const titled = (title: string, amounts: readonly Money[]) =>
    options.amounts && amounts.length > 0 ? `${title} · ${amounts.map(formatMoney).join(' + ')}` : title
  const events: CalendarEvent[] = []

  if (options.cards) {
    for (const { card, current, previous } of await listCardSummaries(today)) {
      // Nothing loaded for it yet still has a due date; a paid one doesn't.
      const previousOwed = previous.due === 'pending' || (previous.due === 'empty' && !card.isArchived)
      if (previousOwed && previous.dueDate >= today) {
        events.push({
          uid: `card-due-${card.id}-${previous.period}`,
          date: previous.dueDate,
          title: titled(`Vence ${card.name}`, previous.owed),
          reminder: DAY_BEFORE,
        })
      }
      if (card.isArchived) continue
      const calendar = await creditCardsRepo.getCardCalendar(card.id)
      const closeNote = calendar.card.closingDayToNext
        ? 'Lo que compres desde hoy va al resumen siguiente.'
        : 'Lo que compres después de hoy va al resumen siguiente.'
      for (let period = current.period; ; period = shiftMonth(period, 1)) {
        const { closeDate, dueDate } = statementDates(calendar, period)
        if (closeDate > until) break
        events.push({ uid: `card-close-${card.id}-${period}`, date: closeDate, title: `Cierra ${card.name}`, description: closeNote })
        if (dueDate <= until) events.push({ uid: `card-due-${card.id}-${period}`, date: dueDate, title: `Vence ${card.name}`, reminder: DAY_BEFORE })
      }
    }
  }

  if (options.fixed) {
    const [plans, expenses] = await Promise.all([recurringPlansRepo.listRecurringPlans(), expensesRepo.listExpensesInRange(today, until)])
    for (const plan of plans.filter((p) => !p.isPaused && (p.kind ?? 'expense') === 'expense' && p.template.cardId === undefined)) {
      const amount = money(plan.template.amount, plan.template.currency)
      // From the first one not generated yet — the same as "Se viene".
      for (const date of pendingOccurrencesInRange(plan.rule, plan.lastMaterializedDate, today, until)) {
        events.push({ uid: `plan-${plan.id}-${date}`, date, title: titled(plan.template.description, [amount]), reminder: DAY_BEFORE })
      }
    }
    // A cuota not paid by card (a loan) is due on its own date.
    for (const cuota of expenses.filter((e) => e.status === 'projected' && e.cardId === undefined)) {
      events.push({
        uid: `cuota-${cuota.id}`,
        date: cuota.date,
        title: titled(cuota.description, [money(cuota.amount, cuota.currency)]),
        reminder: DAY_BEFORE,
      })
    }
  }

  if (events.length > 0) {
    events.push({
      uid: `renew-${until}`,
      date: addDays(until, -14),
      title: 'Bajá de nuevo tus vencimientos de Moneta',
      description: 'Las fechas de este calendario llegan hasta acá: desde Moneta → Inicio → Se viene → Agregar al calendario.',
      reminder: { daysBefore: 0, hour: 10 },
    })
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid))
}
