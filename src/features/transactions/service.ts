import { categoriesRepo, expensesRepo } from '@/database/repositories'
import type { Category, Expense } from '@/domain/entities'
import { money, negate, parseAmount, type Money } from '@/domain/money'
import { monthRange, type DateStamp, type MonthStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type { ExpenseFormValues } from './schema'

export interface TransactionFilters {
  categoryId?: string
}

export interface TransactionListItem {
  id: string
  date: DateStamp
  description: string
  status: Expense['status']
  /** Negated for display: every `Expense.amount` is a positive
   *  magnitude (see CLAUDE.md "Reglas financieras"), but the list shows
   *  it as an outflow — `MoneyText`'s `signColor` reads negative as the
   *  "money left" color. Never write this negated value back to an
   *  Expense; `saveExpense` re-derives the magnitude from the form. */
  amount: Money
  categoryId: string
  categoryLabel?: string
  categoryColor?: string
  categoryIcon?: string
}

export async function listTransactionsForMonth(
  month: MonthStamp,
  filters: TransactionFilters = {},
): Promise<TransactionListItem[]> {
  const { start, end } = monthRange(month)
  const [expenses, categories] = await Promise.all([
    expensesRepo.listExpensesInRange(start, end),
    categoriesRepo.listCategories(),
  ])

  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))

  return expenses
    .filter((expense) => !filters.categoryId || expense.categoryId === filters.categoryId)
    .map((expense) => {
      const category = categoryById.get(expense.categoryId)
      return {
        id: expense.id,
        date: expense.date,
        description: expense.description,
        status: expense.status,
        amount: negate(money(expense.amount, expense.currency)),
        categoryId: expense.categoryId,
        ...(category?.name !== undefined && { categoryLabel: category.name }),
        ...(category?.color !== undefined && { categoryColor: category.color }),
        ...(category?.icon !== undefined && { categoryIcon: category.icon }),
      }
    })
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
    },
    existingId,
  )
}

export async function removeTransaction(id: string): Promise<void> {
  await expensesRepo.deleteExpense(id)
}

// Archived categories can't be picked for a *new* expense, but a past
// expense that already used one still shows its name — see
// listAllCategories, used by the Movimientos filter, which is unfiltered.
export const listCategories = categoriesRepo.listActiveCategories

export async function listAllCategories(): Promise<Category[]> {
  return categoriesRepo.listCategories()
}

export async function createCategoryQuick(name: string): Promise<Category> {
  return categoriesRepo.createCategory({ name })
}
