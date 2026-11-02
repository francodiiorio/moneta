import {
  accountsRepo,
  budgetsRepo,
  cardStatementsRepo,
  categoriesRepo,
  creditCardsRepo,
  exchangeRatesRepo,
  expensesRepo,
  incomesRepo,
  investmentsRepo,
  recurringPlansRepo,
  savingsHoldingsRepo,
  settingsRepo,
} from '@/database/repositories'
import { generateOccurrences, pendingOccurrencesInRange } from '@/domain/recurrence'
import { lastPurchaseDay, statementBalance, statementDates } from '@/domain/cards'
import { monthLeft } from '@/domain/cashflow'
import { convert, MissingRateError } from '@/domain/currency'
import { money, percentChange, sumMoney, type Money } from '@/domain/money'
import { addDays, currentMonthStamp, monthRange, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
// Another feature's service, never its components — see docs/DECISIONS.md
// "Un feature puede importar el service.ts/hooks de otro".
import { listTransactionsForMonth, type TransactionListItem } from '@/features/transactions/service'
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

