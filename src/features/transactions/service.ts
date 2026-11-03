import { categoriesRepo, creditCardsRepo, expensesRepo, incomesRepo } from '@/database/repositories'
import type { Category, CategoryKind, Expense } from '@/domain/entities'
import { money, negate, parseAmount, type Money } from '@/domain/money'
import { statementDates, statementPeriodFor, type CardCalendar } from '@/domain/cards'
import { addDays, formatDueDate, monthRange, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type { ExpenseFormValues, IncomeFormValues, MovementFormValues, MovementKind } from './schema'

export interface TransactionFilters {
  categoryId?: string
}

/** What a Movimientos row can be: a gasto or an ingreso. Since Etapa 10
 *  there are no accounts — transfers, balance adjustments, and investment
 *  purchases or card payments taken from an account aren't listed. */
export type TransactionKind = MovementKind

export interface TransactionListItem {
  id: string
  kind: TransactionKind
  date: DateStamp
  createdAt: string
  description: string
  status: Expense['status']
  /** Signed for display: a gasto is negated (every stored amount is a
   *  positive magnitude, see CLAUDE.md "Reglas financieras") so
   *  `MoneyText`'s `signColor` reads it as money that left; an ingreso
   *  stays positive. Never write this value back — the save path
   *  re-derives the magnitude from the form. */
  amount: Money
  categoryId: string
  categoryLabel?: string
  categoryColor?: string
  categoryIcon?: string
  /** For a gasto paid with a card: the card and its statement's due date
   *  ("Visa · vence el 05/11"). */
  paymentLabel?: string
  cardId?: string
  statementPeriod?: MonthStamp
  /** True when the gasto sits in a statement other than the one its date
   *  puts it in (a late presentation the user pinned) — the edit form then
   *  keeps it pinned; otherwise it offers "según la fecha". */
  statementPinned?: boolean
}

/** Gastos and ingresos of `month`, merged newest-first. Only gastos can be
 *  `projected` — nothing else has plans that project it forward. */
export async function listTransactionsForMonth(
  month: MonthStamp,
  filters: TransactionFilters = {},
): Promise<TransactionListItem[]> {
  const { start, end } = monthRange(month)
  const [expenses, incomes, categories, cards] = await Promise.all([
    expensesRepo.listExpensesInRange(start, end),
    incomesRepo.listIncomesInRange(start, end),
    categoriesRepo.listCategories(),
    creditCardsRepo.listCreditCards(),
  ])
  const cardName = new Map(cards.map((c) => [c.id, c.name]))
  const today = todayStamp()
  const calendars = new Map<string, CardCalendar>()
  for (const cardId of new Set(expenses.flatMap((e) => (e.cardId ? [e.cardId] : [])))) {
    calendars.set(cardId, await creditCardsRepo.getCardCalendar(cardId))
  }

  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))

  function decorate(categoryId: string) {
    const category = categoryById.get(categoryId)
    return {
      categoryId,
      ...(category?.name !== undefined && { categoryLabel: category.name }),
      ...(category?.color !== undefined && { categoryColor: category.color }),
      ...(category?.icon !== undefined && { categoryIcon: category.icon }),
    }
  }

  const items: TransactionListItem[] = [
    ...expenses.map((expense) => ({
      id: expense.id,
      kind: 'expense' as const,
      date: expense.date,
      createdAt: expense.createdAt,
      description: expense.description,
      status: expense.status,
      amount: negate(money(expense.amount, expense.currency)),
      ...decorate(expense.categoryId),
      ...(expense.cardId !== undefined &&
        expense.statementPeriod !== undefined && {
          cardId: expense.cardId,
          statementPeriod: expense.statementPeriod,
          statementPinned: (() => {
            const calendar = calendars.get(expense.cardId)
            return calendar !== undefined && statementPeriodFor(calendar, expense.date) !== expense.statementPeriod
          })(),
          // The statement by when it's due — how the bank and the user name it.
          paymentLabel: (() => {
            const calendar = calendars.get(expense.cardId)
            const card = cardName.get(expense.cardId) ?? 'Tarjeta'
            return calendar === undefined
              ? card
              : `${card} · ${formatDueDate(statementDates(calendar, expense.statementPeriod).dueDate, today)}`
          })(),
        }),
    })),
    ...incomes.map((income) => ({
      id: income.id,
      kind: 'income' as const,
      date: income.date,
      createdAt: income.createdAt,
      description: income.description,
      status: 'confirmed' as const,
      amount: money(income.amount, income.currency),
      ...decorate(income.categoryId),
    })),
  ]

  return items
    .filter((item) => !filters.categoryId || item.categoryId === filters.categoryId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

export async function saveExpense(values: ExpenseFormValues, existingId?: string): Promise<void> {
  const amount = parseAmount(values.amount, values.currency)
  invariant(amount.amount > 0, 'El monto debe ser mayor a cero')
  await expensesRepo.saveExpense(
    {
      date: values.date,
      description: values.description,
      categoryId: values.categoryId,
      amount: amount.amount,
      currency: values.currency,
      status: 'confirmed',
      ...(values.cardId && { cardId: values.cardId }),
      ...(values.cardId && values.statementPeriod && { statementPeriod: values.statementPeriod }),
    },
    existingId,
  )
}

export async function saveIncome(values: IncomeFormValues, existingId?: string): Promise<void> {
  const amount = parseAmount(values.amount, values.currency)
  invariant(amount.amount > 0, 'El monto debe ser mayor a cero')
  await incomesRepo.saveIncome(
    {
      date: values.date,
      description: values.description,
      categoryId: values.categoryId,
      amount: amount.amount,
      currency: values.currency,
    },
    existingId,
  )
}

export async function saveMovement(values: MovementFormValues, existingId?: string): Promise<void> {
  const { kind, ...rest } = values
  if (kind === 'income') {
    await saveIncome(rest, existingId)
  } else {
    await saveExpense(rest, existingId)
  }
}

export async function removeTransaction(id: string, kind: TransactionKind): Promise<void> {
  if (kind === 'income') {
    await incomesRepo.deleteIncome(id)
  } else {
    await expensesRepo.deleteExpense(id)
  }
}

// Archived categories can't be picked for a *new* movement, but a past
// one that already used one still shows its name — see
// listAllCategories, used by the Movimientos filter, which is unfiltered.
export function listCategories(kind: CategoryKind): Promise<Category[]> {
  return categoriesRepo.listActiveCategories(kind)
}

export async function listAllCategories(): Promise<Category[]> {
  return categoriesRepo.listCategories()
}

export async function createCategoryQuick(name: string, kind: CategoryKind): Promise<Category> {
  return categoriesRepo.createCategory({ name, kind })
}

/** Every credit card, archived included — the picker offers only active
 *  ones for a new gasto, but editing one already on an archived card has
 *  to keep showing it. */
export async function listAllCards() {
  return creditCardsRepo.listCreditCards()
}

/** A merchant the user loads often, with how they loaded it last time —
 *  one tap fills the form, leaving only the amount. */
export interface QuickPick {
  description: string
  categoryId: string
  currency: string
  cardId?: string
}

/** How far back "often" looks. */
const QUICK_PICK_DAYS = 90

/**
 * The merchants of the last QUICK_PICK_DAYS, most used first (ties: most
 * recent), each with the category, payment method and currency of its
 * latest entry. Typed by hand only — generated cuotas and recurring gastos
 * ("Mercado Libre (cuota 3/6)") aren't something to type — and only a
 * payment method still in use (not archived).
 */
export async function listQuickPicks(kind: MovementKind, today: DateStamp = todayStamp(), limit = 8): Promise<QuickPick[]> {
  const from = addDays(today, -QUICK_PICK_DAYS)
  const [entries, cards] = await Promise.all([
    kind === 'expense'
      ? expensesRepo.listExpensesInRange(from, today).then((list) => list.filter((e) => e.sourcePlanId === undefined && e.status === 'confirmed'))
      : incomesRepo.listIncomesInRange(from, today).then((list) => list.filter((i) => i.sourcePlanId === undefined)),
    creditCardsRepo.listCreditCards(),
  ])
  const activeCards = new Set(cards.filter((c) => !c.isArchived).map((c) => c.id))

  const byMerchant = new Map<string, { latest: (typeof entries)[number]; count: number }>()
  for (const entry of entries) {
    const key = entry.description.trim().toLowerCase()
    if (!key) continue
    const current = byMerchant.get(key)
    const newer = !current || entry.date > current.latest.date || (entry.date === current.latest.date && entry.createdAt > current.latest.createdAt)
    byMerchant.set(key, { latest: newer ? entry : current.latest, count: (current?.count ?? 0) + 1 })
  }
  return [...byMerchant.values()]
    .sort((a, b) => b.count - a.count || b.latest.date.localeCompare(a.latest.date))
    .slice(0, limit)
    .map(({ latest }) => {
      const cardId = 'cardId' in latest && typeof latest.cardId === 'string' ? latest.cardId : undefined
      return {
        description: latest.description.trim(),
        categoryId: latest.categoryId,
        currency: latest.currency,
        ...(cardId !== undefined && activeCards.has(cardId) && { cardId }),
      }
    })
}
