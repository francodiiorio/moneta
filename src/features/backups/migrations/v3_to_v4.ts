import type { Category, Expense, ExpenseTemplate, InstallmentPlan, InvestmentLot, RecurringPlan } from '@/domain/entities'
import type { BackupDataV3 } from '../schemas/v3'
import type { BackupDataV4 } from '../schemas/v4'

type LegacyTemplate = BackupDataV3['recurringPlans'][number]['template']

/** `undefined` for anything that isn't a plain gasto — an income/transfer
 *  recurring plan has nothing left to become once accounts/income are
 *  gone, so the plan itself is dropped (see the filter below), not
 *  coerced into a bogus expense template. */
function toExpenseTemplate(template: LegacyTemplate): ExpenseTemplate | undefined {
  if (template.kind !== 'expense' || template.categoryId === undefined) return undefined
  return {
    description: template.description,
    categoryId: template.categoryId,
    amount: template.amount,
    currency: template.currency,
  }
}

/**
 * Same reconstruction as `database/db.ts`'s own `version(4)` Dexie
 * upgrade, applied to an imported backup instead of the live database —
 * see ADR "Simplificación: se elimina Cuentas, Ingresos y
 * Transferencias" en docs/DECISIONS.md. Income/transfer/adjustment/
 * investment transactions, their postings, and every account are
 * discarded — a deliberate, irreversible drop decided explicitly by the
 * user, not an oversight. `installmentPlans[].accountId` and
 * `investmentLots[].transactionId` (the since-reverted "cuenta de
 * origen" link) are dropped the same way.
 */
export function migrateV3ToV4(data: BackupDataV3): BackupDataV4 {
  const postingsByTransactionId = new Map<string, BackupDataV3['postings']>()
  for (const posting of data.postings) {
    const list = postingsByTransactionId.get(posting.transactionId) ?? []
    list.push(posting)
    postingsByTransactionId.set(posting.transactionId, list)
  }

  const expenses: Expense[] = []
  for (const transaction of data.transactions) {
    if (transaction.kind !== 'expense') continue
    const categoryPosting = postingsByTransactionId
      .get(transaction.id)
      ?.find((p) => p.target === 'category')
    // No debería poder pasar (todo gasto tiene su pata de categoría), pero
    // una migración corre sobre un archivo potencialmente editado a mano
    // y nunca debe tirar por un dato inconsistente — se descarta esa fila.
    if (!categoryPosting?.categoryId) continue

    expenses.push({
      id: transaction.id,
      date: transaction.date,
      amount: Math.abs(categoryPosting.amount),
      currency: categoryPosting.currency,
      categoryId: categoryPosting.categoryId,
      description: transaction.description,
      status: transaction.status,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      ...(transaction.notes !== undefined && { notes: transaction.notes }),
      ...(transaction.tags !== undefined && { tags: transaction.tags }),
      ...(transaction.sourcePlanId !== undefined && { sourcePlanId: transaction.sourcePlanId }),
      ...(transaction.occurrenceIndex !== undefined && { occurrenceIndex: transaction.occurrenceIndex }),
    })
  }

  const categories: Category[] = data.categories
    .filter((c) => c.kind !== 'income')
    .map((c) => ({
      id: c.id,
      name: c.name,
      order: c.order,
      isArchived: c.isArchived,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...(c.parentId !== undefined && { parentId: c.parentId }),
      ...(c.color !== undefined && { color: c.color }),
      ...(c.icon !== undefined && { icon: c.icon }),
    }))

  const recurringPlans: RecurringPlan[] = []
  for (const plan of data.recurringPlans) {
    const template = toExpenseTemplate(plan.template)
    if (!template) continue
    recurringPlans.push({
      id: plan.id,
      template,
      rule: plan.rule,
      isPaused: plan.isPaused,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      ...(plan.lastMaterializedDate !== undefined && { lastMaterializedDate: plan.lastMaterializedDate }),
    })
  }

  const installmentPlans: InstallmentPlan[] = data.installmentPlans.map((plan) => ({
    id: plan.id,
    description: plan.description,
    categoryId: plan.categoryId,
    currency: plan.currency,
    totalAmount: plan.totalAmount,
    count: plan.count,
    firstDueDate: plan.firstDueDate,
    purchaseDate: plan.purchaseDate,
    scheduleCache: plan.scheduleCache,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  }))

  const investmentLots: InvestmentLot[] = data.investmentLots.map((lot) => ({
    id: lot.id,
    assetId: lot.assetId,
    quantity: lot.quantity,
    currency: lot.currency,
    date: lot.date,
    createdAt: lot.createdAt,
    updatedAt: lot.updatedAt,
    ...(lot.costPerUnit !== undefined && { costPerUnit: lot.costPerUnit }),
    ...(lot.notes !== undefined && { notes: lot.notes }),
  }))

  return {
    categories,
    expenses,
    recurringPlans,
    installmentPlans,
    budgets: data.budgets,
    exchangeRates: data.exchangeRates,
    savingsHoldings: data.savingsHoldings,
    investmentAssets: data.investmentAssets,
    investmentHoldings: data.investmentHoldings,
    assetPrices: data.assetPrices,
    investmentLots,
    ...(data.settings !== undefined && { settings: data.settings }),
  }
}
