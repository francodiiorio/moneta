import { accountAdjustmentsRepo, accountsRepo, categoriesRepo, expensesRepo, incomesRepo } from '@/database/repositories'
import type { Account, Category, CategoryKind, Expense } from '@/domain/entities'
import { money, negate, parseAmount, type Money } from '@/domain/money'
import { monthRange, type DateStamp, type MonthStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type { ExpenseFormValues, IncomeFormValues, MovementFormValues, MovementKind } from './schema'

export interface TransactionFilters {
  categoryId?: string
  accountId?: string
}

/** What a Movimientos row can be: the two kinds the form creates, plus
 *  an "Ajustar saldo" adjustment — listed so every change to an account
 *  balance is visible (and undoable) here, but created only from Cuentas
 *  and never edited, only deleted. */
export type TransactionKind = MovementKind | 'adjustment'

export const ADJUSTMENT_LABEL = 'Ajuste de saldo'

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
  /** '' for an adjustment — it has no category. */
  categoryId: string
  categoryLabel?: string
  categoryColor?: string
  categoryIcon?: string
  accountId?: string
  accountLabel?: string
}

/** A row the Movimientos form can edit — anything but an adjustment. */
export type EditableTransactionItem = TransactionListItem & { kind: MovementKind }

export function isEditableTransaction(item: TransactionListItem): item is EditableTransactionItem {
  return item.kind !== 'adjustment'
}

/** Gastos, ingresos and saldo adjustments of `month`, merged
 *  newest-first. Ingresos and adjustments are always `confirmed` — they
 *  have no plans that project them forward. */
export async function listTransactionsForMonth(
  month: MonthStamp,
  filters: TransactionFilters = {},
): Promise<TransactionListItem[]> {
  const { start, end } = monthRange(month)
  const [expenses, incomes, adjustments, categories, accounts] = await Promise.all([
    expensesRepo.listExpensesInRange(start, end),
    incomesRepo.listIncomesInRange(start, end),
    accountAdjustmentsRepo.listAdjustmentsInRange(start, end),
    categoriesRepo.listCategories(),
    accountsRepo.listAccounts(),
  ])

  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))
  const accountById = new Map(accounts.map((a) => [a.id, a] as [string, Account]))

  function decorate(categoryId: string, accountId: string | undefined) {
    const category = categoryById.get(categoryId)
    const account = accountId !== undefined ? accountById.get(accountId) : undefined
    return {
      categoryId,
      ...(category?.name !== undefined && { categoryLabel: category.name }),
      ...(category?.color !== undefined && { categoryColor: category.color }),
      ...(category?.icon !== undefined && { categoryIcon: category.icon }),
      ...(accountId !== undefined && { accountId }),
      ...(account !== undefined && { accountLabel: account.name }),
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
      ...decorate(expense.categoryId, expense.accountId),
    })),
    ...incomes.map((income) => ({
      id: income.id,
      kind: 'income' as const,
      date: income.date,
      createdAt: income.createdAt,
      description: income.description,
      status: 'confirmed' as const,
      amount: money(income.amount, income.currency),
      ...decorate(income.categoryId, income.accountId),
    })),
    ...adjustments.map((adjustment) => ({
      id: adjustment.id,
      kind: 'adjustment' as const,
      date: adjustment.date,
      createdAt: adjustment.createdAt,
      description: adjustment.description ?? ADJUSTMENT_LABEL,
      status: 'confirmed' as const,
      amount: money(adjustment.amount, adjustment.currency),
      ...decorate('', adjustment.accountId),
      categoryLabel: ADJUSTMENT_LABEL,
    })),
  ]

  return items
    .filter((item) => !filters.categoryId || item.categoryId === filters.categoryId)
    .filter((item) => !filters.accountId || item.accountId === filters.accountId)
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
      ...(values.accountId && { accountId: values.accountId }),
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
      accountId: values.accountId,
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
  } else if (kind === 'adjustment') {
    await accountAdjustmentsRepo.deleteAdjustment(id)
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

/** Every account, archived included — the picker offers only active ones
 *  for a new movement, but editing one that already points at an
 *  archived account has to keep showing it. */
export async function listAllAccounts(): Promise<Account[]> {
  return accountsRepo.listAccounts()
}
