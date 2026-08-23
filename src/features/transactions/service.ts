import { accountsRepo, categoriesRepo, transactionsRepo } from '@/database/repositories'
import type { AccountWithBalance } from '@/database/repositories/accounts.repo'
import type { Category, Transaction } from '@/domain/entities'
import { buildExpense, buildFxTransfer, buildIncome, buildTransfer, type LedgerEntryDraft } from '@/domain/ledger'
import { money, parseAmount, type Money } from '@/domain/money'
import { monthRange, type DateStamp, type MonthStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type { ExpenseIncomeFormValues, TransferFormValues } from './schema'

export interface TransactionFilters {
  accountId?: string
  categoryId?: string
}

export interface TransactionListItem {
  id: string
  date: DateStamp
  kind: Transaction['kind']
  description: string
  status: Transaction['status']
  /** Signed headline amount for display (see service.ts for sign convention per kind). */
  amount: Money
  accountLabel: string
  categoryLabel?: string
  // Raw fields to prefill the edit form — absent depending on `kind`.
  accountId?: string
  categoryId?: string
  fromAccountId?: string
  toAccountId?: string
  fromAmount?: Money
  toAmount?: Money
}

export async function listTransactionsForMonth(
  month: MonthStamp,
  filters: TransactionFilters = {},
): Promise<TransactionListItem[]> {
  const { start, end } = monthRange(month)
  const [items, accounts, categories] = await Promise.all([
    transactionsRepo.listTransactionsInRange(start, end),
    accountsRepo.listAccountsWithBalances(),
    categoriesRepo.listCategories(),
  ])

  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))

  const result: TransactionListItem[] = []

  for (const { transaction, postings } of items) {
    if (filters.accountId && !postings.some((p) => p.accountId === filters.accountId)) continue
    if (filters.categoryId && !postings.some((p) => p.categoryId === filters.categoryId)) continue

    const accountPostings = postings.filter((p) => p.target === 'account')
    const categoryPosting = postings.find((p) => p.target === 'category')
    const categoryLabel = categoryPosting?.categoryId
      ? categoryById.get(categoryPosting.categoryId)?.name
      : undefined

    if (transaction.kind === 'transfer') {
      const outgoing = accountPostings.find((p) => p.amount < 0)
      const incoming = accountPostings.find((p) => p.amount > 0)
      const fromName = outgoing?.accountId ? accountById.get(outgoing.accountId)?.name : undefined
      const toName = incoming?.accountId ? accountById.get(incoming.accountId)?.name : undefined
      const headline = incoming ?? accountPostings[0]

      result.push({
        id: transaction.id,
        date: transaction.date,
        kind: transaction.kind,
        description: transaction.description,
        status: transaction.status,
        amount: money(headline?.amount ?? 0, headline?.currency ?? 'ARS'),
        accountLabel: `${fromName ?? '—'} → ${toName ?? '—'}`,
        ...(outgoing?.accountId !== undefined && { fromAccountId: outgoing.accountId }),
        ...(incoming?.accountId !== undefined && { toAccountId: incoming.accountId }),
        ...(outgoing && { fromAmount: money(-outgoing.amount, outgoing.currency) }),
        ...(incoming && { toAmount: money(incoming.amount, incoming.currency) }),
      })
      continue
    }

    const posting = accountPostings[0]
    result.push({
      id: transaction.id,
      date: transaction.date,
      kind: transaction.kind,
      description: transaction.description,
      status: transaction.status,
      amount: money(posting?.amount ?? 0, posting?.currency ?? 'ARS'),
      accountLabel: (posting?.accountId && accountById.get(posting.accountId)?.name) || '—',
      ...(categoryLabel !== undefined && { categoryLabel }),
      ...(posting?.accountId !== undefined && { accountId: posting.accountId }),
      ...(categoryPosting?.categoryId !== undefined && { categoryId: categoryPosting.categoryId }),
    })
  }

  return result
}

function findAccount(accounts: AccountWithBalance[], id: string): AccountWithBalance {
  const account = accounts.find((a) => a.id === id)
  invariant(account, `Cuenta no encontrada: ${id}`)
  return account
}

function buildExpenseIncomeEntry(
  kind: 'expense' | 'income',
  values: ExpenseIncomeFormValues,
  accounts: AccountWithBalance[],
): LedgerEntryDraft {
  const account = findAccount(accounts, values.accountId)
  const amount = parseAmount(values.amount, account.currency)
  invariant(amount.amount > 0, 'El monto debe ser mayor a cero')
  const params = {
    date: values.date,
    description: values.description,
    accountId: values.accountId,
    categoryId: values.categoryId,
    amount,
  }
  return kind === 'expense' ? buildExpense(params) : buildIncome(params)
}

export async function saveExpenseIncome(
  kind: 'expense' | 'income',
  values: ExpenseIncomeFormValues,
  accounts: AccountWithBalance[],
  existingId?: string,
): Promise<void> {
  const entry = buildExpenseIncomeEntry(kind, values, accounts)
  await transactionsRepo.saveTransaction(entry, existingId)
}

export async function saveTransfer(
  values: TransferFormValues,
  accounts: AccountWithBalance[],
  existingId?: string,
): Promise<void> {
  const from = findAccount(accounts, values.fromAccountId)
  const to = findAccount(accounts, values.toAccountId)

  if (from.currency === to.currency) {
    const amount = parseAmount(values.amount, from.currency)
    invariant(amount.amount > 0, 'El monto debe ser mayor a cero')
    const entry = buildTransfer({
      date: values.date,
      description: values.description,
      fromAccountId: from.id,
      toAccountId: to.id,
      amount,
    })
    await transactionsRepo.saveTransaction(entry, existingId)
    return
  }

  invariant(values.toAmount, 'El monto recibido es obligatorio en una transferencia entre monedas distintas')
  const fromAmount = parseAmount(values.amount, from.currency)
  const toAmount = parseAmount(values.toAmount, to.currency)
  invariant(fromAmount.amount > 0 && toAmount.amount > 0, 'Los montos deben ser mayores a cero')

  const entry = buildFxTransfer({
    date: values.date,
    description: values.description,
    fromAccountId: from.id,
    toAccountId: to.id,
    fromAmount,
    toAmount,
    rate: toAmount.amount / fromAmount.amount,
  })
  await transactionsRepo.saveTransaction(entry, existingId)
}

export async function removeTransaction(id: string): Promise<void> {
  await transactionsRepo.deleteTransaction(id)
}

export { listAccountsWithBalances } from '@/database/repositories/accounts.repo'
export type { AccountWithBalance } from '@/database/repositories/accounts.repo'

export async function listCategoriesByKind(kind: Category['kind']): Promise<Category[]> {
  const categories = await categoriesRepo.listCategories()
  // Archived categories can't be picked for a *new* transaction, but a past
  // transaction that already used one still shows its name — see
  // listAllCategories, used by the Movimientos filter, which is unfiltered.
  return categories.filter((c) => c.kind === kind && !c.isArchived)
}

export async function listAllCategories(): Promise<Category[]> {
  return categoriesRepo.listCategories()
}

export async function createCategoryQuick(name: string, kind: Category['kind']): Promise<Category> {
  return categoriesRepo.createCategory({ name, kind })
}
