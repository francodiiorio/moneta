import {
  accountsRepo,
  categoriesRepo,
  installmentPlansRepo,
  recurringPlansRepo,
  transactionsRepo,
} from '@/database/repositories'
import type { AccountWithBalance } from '@/database/repositories/accounts.repo'
import type { Category, InstallmentPlan, RecurringPlan, Transaction, TransactionTemplate } from '@/domain/entities'
import { buildExpense, buildIncome, buildTransfer, type LedgerEntryDraft } from '@/domain/ledger'
import { describeRule, generateOccurrences, nextOccurrenceAfter } from '@/domain/recurrence'
import { money, parseAmount, sub, sumMoney, type Money } from '@/domain/money'
import { todayStamp, type DateStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type { InstallmentPlanFormValues, RecurringPlanFormValues } from './schema'

function findAccount(accounts: AccountWithBalance[], id: string): AccountWithBalance {
  const account = accounts.find((a) => a.id === id)
  invariant(account, `Cuenta no encontrada: ${id}`)
  return account
}

function buildTemplateEntry(
  template: TransactionTemplate,
  date: DateStamp,
  sourcePlanId: string,
  occurrenceIndex: number,
): LedgerEntryDraft {
  const amount = money(template.amount, template.currency)
  const base = { date, description: template.description, sourcePlanId, occurrenceIndex }
  switch (template.kind) {
    case 'expense':
      invariant(template.categoryId, 'La plantilla de un gasto recurrente necesita categoryId')
      return buildExpense({ ...base, accountId: template.accountId, categoryId: template.categoryId, amount })
    case 'income':
      invariant(template.categoryId, 'La plantilla de un ingreso recurrente necesita categoryId')
      return buildIncome({ ...base, accountId: template.accountId, categoryId: template.categoryId, amount })
    case 'transfer':
      invariant(template.toAccountId, 'La plantilla de una transferencia recurrente necesita toAccountId')
      return buildTransfer({ ...base, fromAccountId: template.accountId, toAccountId: template.toAccountId, amount })
    case 'adjustment':
      throw new Error(`Los recurrentes no soportan kind: ${template.kind}`)
  }
}

export interface MaterializationSummary {
  recurringCreated: number
  installmentsConfirmed: number
  /** ids of recurring plans that threw while materializing (e.g. a plan
   *  left in an invalid state by a hand-edited backup import) — these are
   *  skipped, not fatal to the rest, see the per-plan try/catch below. */
  failedPlanIds: string[]
}

/**
 * Catches up everything due as of `today`: creates confirmed transactions
 * for every recurring occurrence since each plan's last materialized
 * date, and promotes any `projected` cuota whose date has arrived to
 * `confirmed`. Safe to call on every app load — a plan's watermark
 * (`lastMaterializedDate`) only advances together with its writes, in the
 * same transaction, so running this twice in a row creates nothing new
 * the second time.
 *
 * Each plan is materialized independently: a single plan that fails
 * (in practice, only reachable via a hand-edited backup import — the
 * form-level validation in createRecurringPlanFromForm rejects the one
 * known way to construct a bad plan, a cross-currency transfer) is
 * skipped rather than aborting every other plan and the cuota sweep.
 * Before this guard, one broken plan would silently stop ALL recurring
 * materialization and installment confirmation, forever, on every app
 * load — see docs/DECISIONS.md if that's documented, otherwise treat
 * this comment as the record of why the try/catch is here.
 */
export async function materializeDue(today: DateStamp = todayStamp()): Promise<MaterializationSummary> {
  const plans = await recurringPlansRepo.listRecurringPlans()
  let recurringCreated = 0
  const failedPlanIds: string[] = []

  for (const plan of plans) {
    if (plan.isPaused) continue
    try {
      const since = plan.lastMaterializedDate ?? ''
      const due = generateOccurrences(plan.rule, today)
        .map((date, index) => ({ date, index }))
        .filter((occurrence) => occurrence.date > since)
      if (due.length === 0) continue

      const entries = due.map((occurrence) =>
        buildTemplateEntry(plan.template, occurrence.date, plan.id, occurrence.index),
      )
      const throughDate = due[due.length - 1]!.date
      await recurringPlansRepo.materializePlan(plan.id, entries, throughDate)
      recurringCreated += entries.length
    } catch (error) {
      failedPlanIds.push(plan.id)
      console.error(`No se pudo poner al día el recurrente ${plan.id}`, error)
    }
  }

  const installmentsConfirmed = await transactionsRepo.confirmDueProjected(today)

  return { recurringCreated, installmentsConfirmed, failedPlanIds }
}

export interface RecurringPlanListItem {
  id: string
  description: string
  kind: TransactionTemplate['kind']
  accountLabel: string
  categoryLabel?: string
  toAccountLabel?: string
  amount: Money
  ruleDescription: string
  isPaused: boolean
  nextOccurrence?: DateStamp
}

export async function listRecurringPlansWithNext(): Promise<RecurringPlanListItem[]> {
  const [plans, accounts, categories] = await Promise.all([
    recurringPlansRepo.listRecurringPlans(),
    accountsRepo.listAccountsWithBalances(),
    categoriesRepo.listCategories(),
  ])
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))
  const today = todayStamp()

  return plans.map((plan) => {
    const { template } = plan
    const nextOccurrence = plan.isPaused ? undefined : nextOccurrenceAfter(plan.rule, today)
    return {
      id: plan.id,
      description: template.description,
      kind: template.kind,
      accountLabel: accountById.get(template.accountId)?.name ?? '—',
      ...(template.categoryId !== undefined && { categoryLabel: categoryById.get(template.categoryId)?.name ?? '—' }),
      ...(template.toAccountId !== undefined && { toAccountLabel: accountById.get(template.toAccountId)?.name ?? '—' }),
      amount: money(template.amount, template.currency),
      ruleDescription: describeRule(plan.rule),
      isPaused: plan.isPaused,
      ...(nextOccurrence !== undefined && { nextOccurrence }),
    }
  })
}

export async function createRecurringPlanFromForm(values: RecurringPlanFormValues): Promise<RecurringPlan> {
  const accounts = await accountsRepo.listAccountsWithBalances()
  const account = findAccount(accounts, values.accountId)
  const amount = parseAmount(values.amount, account.currency)

  // A recurring transfer template has a single amount+currency (see
  // domain/entities/schemas.ts:TransactionTemplate) — there's no fx/toAmount
  // field to represent a cross-currency leg, unlike a one-off transfer
  // (features/transactions/service.ts:saveTransfer, which branches to
  // buildFxTransfer). buildTemplateEntry always calls buildTransfer, which
  // would otherwise write the destination posting in the wrong currency and
  // fail validateLedgerEntry deep inside materializeDue — silently blocking
  // every other plan's materialization too. Reject it here instead, at
  // creation time, where the user can see why.
  if (values.kind === 'transfer') {
    const toAccount = findAccount(accounts, values.toAccountId)
    invariant(
      toAccount.currency === account.currency,
      'Un recurrente de transferencia no puede ser entre cuentas de distinta moneda',
    )
  }

  const template: TransactionTemplate = {
    description: values.description,
    kind: values.kind,
    accountId: values.accountId,
    amount: amount.amount,
    currency: account.currency,
    ...(values.categoryId !== '' && { categoryId: values.categoryId }),
    ...(values.toAccountId !== '' && { toAccountId: values.toAccountId }),
  }

  const interval = Number(values.interval)
  const dayOfMonth = values.dayOfMonth ? Number(values.dayOfMonth) : undefined
  const maxOccurrences = values.maxOccurrences ? Number(values.maxOccurrences) : undefined

  return recurringPlansRepo.createRecurringPlan({
    template,
    rule: {
      freq: values.freq,
      interval,
      startDate: values.startDate,
      ...(dayOfMonth !== undefined && { dayOfMonth }),
      ...(values.endDate !== undefined && values.endDate !== '' && { endDate: values.endDate }),
      ...(maxOccurrences !== undefined && { maxOccurrences }),
    },
  })
}

export async function setRecurringPlanPaused(id: string, isPaused: boolean): Promise<void> {
  await recurringPlansRepo.setRecurringPlanPaused(id, isPaused)
}

export async function removeRecurringPlan(id: string): Promise<void> {
  await recurringPlansRepo.deleteRecurringPlan(id)
}

export interface InstallmentPlanListItem {
  id: string
  description: string
  accountLabel: string
  categoryLabel: string
  totalAmount: Money
  count: number
  confirmedCount: number
  remaining: Money
}

export async function listInstallmentPlansWithProgress(): Promise<InstallmentPlanListItem[]> {
  const [plans, accounts, categories, planTransactions] = await Promise.all([
    installmentPlansRepo.listInstallmentPlans(),
    accountsRepo.listAccountsWithBalances(),
    categoriesRepo.listCategories(),
    transactionsRepo.listPlanTransactions(),
  ])
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))

  // Indexed by occurrenceIndex, not just counted, so that deleting or
  // editing a single cuota (allowed — see docs/DECISIONS.md) doesn't
  // throw off the count/amount of the others: a gap in the middle stays
  // a gap instead of silently shifting later cuotas down by one.
  const confirmedIndexesByPlan = new Map<string, Set<number>>()
  for (const transaction of planTransactions) {
    if (transaction.status !== 'confirmed' || !transaction.sourcePlanId || transaction.occurrenceIndex === undefined) {
      continue
    }
    const indexes = confirmedIndexesByPlan.get(transaction.sourcePlanId) ?? new Set<number>()
    indexes.add(transaction.occurrenceIndex)
    confirmedIndexesByPlan.set(transaction.sourcePlanId, indexes)
  }

  return plans.map((plan) => {
    const confirmedIndexes = confirmedIndexesByPlan.get(plan.id) ?? new Set<number>()
    const confirmedAmount = sumMoney(
      plan.currency,
      plan.scheduleCache
        .filter((_, index) => confirmedIndexes.has(index))
        .map((amount) => money(amount, plan.currency)),
    )
    const totalAmount = money(plan.totalAmount, plan.currency)
    return {
      id: plan.id,
      description: plan.description,
      accountLabel: accountById.get(plan.accountId)?.name ?? '—',
      categoryLabel: categoryById.get(plan.categoryId)?.name ?? 'Categoría eliminada',
      totalAmount,
      count: plan.count,
      confirmedCount: confirmedIndexes.size,
      remaining: sub(totalAmount, confirmedAmount),
    }
  })
}

export async function createInstallmentPlanFromForm(values: InstallmentPlanFormValues): Promise<InstallmentPlan> {
  const accounts = await accountsRepo.listAccountsWithBalances()
  const account = findAccount(accounts, values.accountId)
  const totalAmount = parseAmount(values.totalAmount, account.currency)

  return installmentPlansRepo.createInstallmentPlan({
    description: values.description,
    accountId: values.accountId,
    categoryId: values.categoryId,
    currency: account.currency,
    totalAmount: totalAmount.amount,
    count: Number(values.count),
    firstDueDate: values.firstDueDate,
    purchaseDate: values.purchaseDate,
  })
}

export async function removeInstallmentPlan(id: string): Promise<void> {
  await installmentPlansRepo.deleteInstallmentPlan(id)
}

export async function listExpenseCategories(): Promise<Category[]> {
  const categories = await categoriesRepo.listCategories()
  return categories.filter((c) => c.kind === 'expense' && !c.isArchived)
}

export async function listIncomeCategories(): Promise<Category[]> {
  const categories = await categoriesRepo.listCategories()
  return categories.filter((c) => c.kind === 'income' && !c.isArchived)
}

export { listAccountsWithBalances } from '@/database/repositories/accounts.repo'
export type { AccountWithBalance } from '@/database/repositories/accounts.repo'
export type { Transaction }
