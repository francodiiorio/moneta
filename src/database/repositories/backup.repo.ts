import type { EntityTable } from 'dexie'
import { db } from '../db'
import { movementAccountProblem, transferProblem } from '@/domain/accounts'
import { statementPaymentProblem } from '@/domain/cards'
import { firstPendingOccurrence } from '@/domain/recurrence'
import { shiftMonth } from '@/lib/dates'
import { reassignCardExpenses, getCardCalendar } from './creditCards.repo'
import type { CardCalendar } from '@/domain/cards'
import type {
  Account,
  AccountAdjustment,
  AssetPrice,
  Budget,
  CardStatement,
  CreditCard,
  Category,
  ExchangeRate,
  Expense,
  Income,
  InstallmentPlan,
  InvestmentAsset,
  InvestmentHolding,
  InvestmentLot,
  RecurringPlan,
  SavingsHolding,
  Settings,
  StatementPayment,
  Transfer,
} from '@/domain/entities'

export interface AllTablesData {
  categories: Category[]
  expenses: Expense[]
  recurringPlans: RecurringPlan[]
  installmentPlans: InstallmentPlan[]
  budgets: Budget[]
  exchangeRates: ExchangeRate[]
  settings?: Settings | undefined
  savingsHoldings: SavingsHolding[]
  investmentAssets: InvestmentAsset[]
  investmentHoldings: InvestmentHolding[]
  assetPrices: AssetPrice[]
  investmentLots: InvestmentLot[]
  accounts: Account[]
  incomes: Income[]
  accountAdjustments: AccountAdjustment[]
  transfers: Transfer[]
  creditCards: CreditCard[]
  cardStatements: CardStatement[]
  statementPayments: StatementPayment[]
}

/** Every table a full backup touches — shared by replaceAllTables and
 *  mergeAllTables so a future table addition can't update one and miss
 *  the other's transaction scope. */
function allTables() {
  return [
    db.categories,
    db.expenses,
    db.recurringPlans,
    db.installmentPlans,
    db.budgets,
    db.exchangeRates,
    db.settings,
    db.savingsHoldings,
    db.investmentAssets,
    db.investmentHoldings,
    db.assetPrices,
    db.investmentLots,
    db.accounts,
    db.incomes,
    db.accountAdjustments,
    db.transfers,
    db.creditCards,
    db.cardStatements,
    db.statementPayments,
  ] as const
}

export async function readAllTables(): Promise<AllTablesData> {
  const [
    categories,
    expenses,
    recurringPlans,
    installmentPlans,
    budgets,
    exchangeRates,
    settings,
    savingsHoldings,
    investmentAssets,
    investmentHoldings,
    assetPrices,
    investmentLots,
    accounts,
    incomes,
    accountAdjustments,
    transfers,
    creditCards,
    cardStatements,
    statementPayments,
  ] = await Promise.all([
    db.categories.toArray(),
    db.expenses.toArray(),
    db.recurringPlans.toArray(),
    db.installmentPlans.toArray(),
    db.budgets.toArray(),
    db.exchangeRates.toArray(),
    db.settings.get('singleton'),
    db.savingsHoldings.toArray(),
    db.investmentAssets.toArray(),
    db.investmentHoldings.toArray(),
    db.assetPrices.toArray(),
    db.investmentLots.toArray(),
    db.accounts.toArray(),
    db.incomes.toArray(),
    db.accountAdjustments.toArray(),
    db.transfers.toArray(),
    db.creditCards.toArray(),
    db.cardStatements.toArray(),
    db.statementPayments.toArray(),
  ])
  return {
    categories,
    expenses,
    recurringPlans,
    installmentPlans,
    budgets,
    exchangeRates,
    savingsHoldings,
    investmentAssets,
    investmentHoldings,
    assetPrices,
    investmentLots,
    accounts,
    incomes,
    accountAdjustments,
    transfers,
    creditCards,
    cardStatements,
    statementPayments,
    ...(settings !== undefined && { settings }),
  }
}

/** Erases everything the app stores — every table of the database, the
 *  settings included, not just the ones a backup lists — atomically:
 *  "Borrar todos los datos" in Ajustes. The app reseeds its default
 *  categories on the next start. */
export async function wipeAllTables(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}

/** Wipes every table and repopulates it from `data`, atomically. Used
 *  only by backup import — see features/backups/import.ts, which
 *  validates and migrates `data` before calling this. */
export async function replaceAllTables(data: AllTablesData): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    await Promise.all(allTables().map((table) => table.clear()))
    await Promise.all([
      db.categories.bulkAdd(data.categories),
      db.expenses.bulkAdd(data.expenses),
      db.recurringPlans.bulkAdd(data.recurringPlans),
      db.installmentPlans.bulkAdd(data.installmentPlans),
      db.budgets.bulkAdd(data.budgets),
      db.exchangeRates.bulkAdd(data.exchangeRates),
      data.settings ? db.settings.add(data.settings) : Promise.resolve(),
      db.savingsHoldings.bulkAdd(data.savingsHoldings),
      db.investmentAssets.bulkAdd(data.investmentAssets),
      db.investmentHoldings.bulkAdd(data.investmentHoldings),
      db.assetPrices.bulkAdd(data.assetPrices),
      db.investmentLots.bulkAdd(data.investmentLots),
      db.accounts.bulkAdd(data.accounts),
      db.incomes.bulkAdd(data.incomes),
      db.accountAdjustments.bulkAdd(data.accountAdjustments),
      db.transfers.bulkAdd(data.transfers),
      db.creditCards.bulkAdd(data.creditCards),
      db.cardStatements.bulkAdd(data.cardStatements),
      db.statementPayments.bulkAdd(data.statementPayments),
    ])
  })
}

export interface MergeCounts {
  /** Rows that were new and got written. */
  added: number
  /** Rows the file had for this table that were already present locally
   *  (by id, or — for expenses — by the occurrence they represent) and
   *  were left untouched. Lets the UI say "you already had N of these"
   *  instead of guessing from a zero `added` count, which could also just
   *  mean the file had none of that kind at all. */
  skipped: number
}

export interface MergeSummary {
  categories: MergeCounts
  expenses: MergeCounts
  recurringPlans: MergeCounts
  installmentPlans: MergeCounts
  budgets: MergeCounts
  exchangeRates: MergeCounts
  savingsHoldings: MergeCounts
  investmentAssets: MergeCounts
  investmentHoldings: MergeCounts
  assetPrices: MergeCounts
  investmentLots: MergeCounts
  accounts: MergeCounts
  incomes: MergeCounts
  accountAdjustments: MergeCounts
  transfers: MergeCounts
  creditCards: MergeCounts
  cardStatements: MergeCounts
  statementPayments: MergeCounts
}

/** Adds only the rows of `incoming` whose id isn't already present in
 *  `table` — existing rows are never overwritten. Returns the rows that
 *  were actually added alongside how many were skipped as already-present. */
async function addMissing<T extends { id: string }>(
  table: EntityTable<T, 'id'>,
  incoming: readonly T[],
): Promise<{ added: T[]; skipped: number }> {
  const existingIds = new Set<string>(await table.toCollection().primaryKeys())
  const added = incoming.filter((row) => !existingIds.has(row.id))
  if (added.length > 0) await table.bulkAdd(added)
  return { added, skipped: incoming.length - added.length }
}

/**
 * Throws (rolling back the whole merge) if any movement the merge just
 * added doesn't fit the account and category that actually ended up in
 * the database. `validateLedgerIntegrity` already checked the file
 * against itself, but in a merge the LOCAL account wins on an id clash —
 * and the local copy may have since changed currency or opening date (an
 * edit allowed while it had no movements locally). Without this, an
 * incoming ARS ingreso could land in a now-USD account and make every
 * balance computation throw, or fall before the opening date and silently
 * stop counting. Must run inside `mergeAllTables`' transaction.
 */
async function assertMergedMovementsFit(added: {
  incomes: readonly Income[]
  expenses: readonly Expense[]
  adjustments: readonly AccountAdjustment[]
  transfers: readonly Transfer[]
  investmentLots: readonly InvestmentLot[]
  installmentPlans: readonly InstallmentPlan[]
  recurringPlans: readonly RecurringPlan[]
}): Promise<void> {
  const accountById = new Map((await db.accounts.toArray()).map((a) => [a.id, a]))
  const categoryKindById = new Map((await db.categories.toArray()).map((c) => [c.id, c.kind]))

  function check(label: string, accountId: string, movement: { date: string; currency: string }): void {
    const account = accountById.get(accountId)
    if (!account) throw new Error(`${label}: la cuenta ${accountId} no existe`)
    const problem = movementAccountProblem(account, movement)
    if (problem) throw new Error(`${label}: ${problem} (en tu base local)`)
  }

  for (const income of added.incomes) {
    const label = `Ingreso "${income.description}" (${income.id})`
    if (categoryKindById.get(income.categoryId) !== 'income') {
      throw new Error(`${label}: la categoría no existe o no es de ingreso en tu base local`)
    }
    check(label, income.accountId, income)
  }
  for (const expense of added.expenses) {
    const label = `Gasto "${expense.description}" (${expense.id})`
    if (categoryKindById.get(expense.categoryId) === 'income') {
      throw new Error(`${label}: usa una categoría de ingreso en tu base local`)
    }
    if (expense.accountId !== undefined) check(label, expense.accountId, expense)
  }
  for (const adjustment of added.adjustments) {
    check(`Ajuste de saldo (${adjustment.id})`, adjustment.accountId, adjustment)
  }
  const cardIds = new Set((await db.creditCards.toArray()).map((c) => c.id))
  for (const plan of added.installmentPlans) {
    if (plan.cardId !== undefined && !cardIds.has(plan.cardId)) {
      throw new Error(`Compra en cuotas "${plan.description}" (${plan.id}): la tarjeta ${plan.cardId} no existe`)
    }
  }
  for (const plan of added.recurringPlans) {
    const { accountId, cardId, description } = plan.template
    if (cardId !== undefined && !cardIds.has(cardId)) {
      throw new Error(`Recurrente "${description}" (${plan.id}): la tarjeta ${cardId} no existe`)
    }
    if (accountId !== undefined) {
      const account = accountById.get(accountId)
      if (!account) throw new Error(`Recurrente "${description}" (${plan.id}): la cuenta ${accountId} no existe`)
      const next = firstPendingOccurrence(plan.rule, plan.lastMaterializedDate)
      const problem = movementAccountProblem(account, { date: next ?? account.openingDate, currency: plan.template.currency })
      if (problem) throw new Error(`Recurrente "${description}" (${plan.id}): ${problem} (en tu base local)`)
    }
  }
  for (const expense of added.expenses) {
    if (expense.cardId !== undefined && !cardIds.has(expense.cardId)) {
      throw new Error(`Gasto "${expense.description}" (${expense.id}): la tarjeta ${expense.cardId} no existe`)
    }
  }
  for (const lot of added.investmentLots) {
    const present = [lot.sourceAccountId, lot.sourceAmount, lot.sourceCurrency].filter((v) => v !== undefined).length
    if (present !== 0 && present !== 3) {
      throw new Error(`Compra de inversión (${lot.id}): cuenta de origen, monto y moneda van juntos`)
    }
    if (lot.sourceAccountId === undefined || lot.sourceAmount === undefined || lot.sourceCurrency === undefined) continue
    check(`Compra de inversión (${lot.id})`, lot.sourceAccountId, { date: lot.date, currency: lot.sourceCurrency })
  }
  for (const transfer of added.transfers) {
    const label = `Transferencia "${transfer.description}" (${transfer.id})`
    const from = accountById.get(transfer.fromAccountId)
    const to = accountById.get(transfer.toAccountId)
    if (!from || !to) throw new Error(`${label}: una de sus cuentas no existe`)
    const problem = transferProblem(transfer, from, to)
    if (problem) throw new Error(`${label}: ${problem} (en tu base local)`)
  }
}

/**
 * Adds whatever in `data` isn't already present locally — never
 * overwrites or deletes anything that already exists. Used by backup
 * import's merge mode; see docs/DECISIONS.md "Merge de backup: la base
 * local siempre gana" for why this is the only direction that's safe
 * without a full conflict-resolution UI.
 *
 * `expenses` are deduplicated by id AND, when `sourcePlanId` is set, by
 * `sourcePlanId + date` too. A `RecurringPlan` that already existed on
 * both devices before they diverged gets its occurrences materialized
 * independently by each device's own `materializeDue()` — same calendar
 * occurrence, but `generateId()` (lib/ids.ts) is random, so the two
 * devices produce different expense ids for it. Deduplicating by id
 * alone would treat them as unrelated and add both, silently
 * double-counting that expense in reports/budgets — exactly the scenario
 * this feature exists to consolidate safely.
 *
 * The second key is `date`, not `occurrenceIndex`, deliberately: editing a
 * RecurringPlan's rule (`recurringPlans.repo.ts:updateRecurringPlan`) can
 * shift what index a given calendar date gets — `generateOccurrences`
 * numbers occurrences by counting forward from `rule.startDate`, so moving
 * `startDate` earlier makes every later occurrence land on a higher index
 * than it used to. Two devices that materialized the same occurrence
 * before one of them edited the rule could then disagree on that
 * occurrence's index while still agreeing on its date — the date is what
 * `materializeDue`'s own single-device dedup (`occurrence.date > since`)
 * already treats as the real identity of an occurrence, so the merge uses
 * the same ground truth. An edit made through the expense edit form itself
 * drops `sourcePlanId`/`occurrenceIndex` entirely (see
 * `features/transactions/service.ts`, which never sets them on a manual
 * edit) — such an expense is already excluded from this key by the
 * `sourcePlanId !== undefined` check, so it can never disagree with an
 * incoming backup on its own edited date.
 *
 * After merging, every `RecurringPlan` left in the table (existing or
 * newly added) gets its `lastMaterializedDate` repaired to the latest
 * date actually materialized for it locally. Without this,
 * `materializeDue()` (features/plans/service.ts) — which trusts that
 * watermark blindly to decide what's still due — would treat occurrences
 * merged in from another device as not-yet-materialized and generate
 * duplicate expenses for them the next time the app opens.
 */
export async function mergeAllTables(data: AllTablesData): Promise<MergeSummary> {
  return db.transaction('rw', allTables(), async () => {
    const [
      categories,
      recurringPlans,
      installmentPlans,
      budgets,
      exchangeRates,
      savingsHoldings,
      investmentAssets,
      investmentHoldings,
      assetPrices,
      investmentLots,
      accounts,
      incomes,
      accountAdjustments,
      transfers,
      creditCards,
    ] = await Promise.all([
      addMissing(db.categories, data.categories),
      addMissing(db.recurringPlans, data.recurringPlans),
      addMissing(db.installmentPlans, data.installmentPlans),
      addMissing(db.budgets, data.budgets),
      addMissing(db.exchangeRates, data.exchangeRates),
      addMissing(db.savingsHoldings, data.savingsHoldings),
      addMissing(db.investmentAssets, data.investmentAssets),
      addMissing(db.investmentHoldings, data.investmentHoldings),
      addMissing(db.assetPrices, data.assetPrices),
      addMissing(db.investmentLots, data.investmentLots),
      addMissing(db.accounts, data.accounts),
      addMissing(db.incomes, data.incomes),
      addMissing(db.accountAdjustments, data.accountAdjustments),
      addMissing(db.transfers, data.transfers),
      addMissing(db.creditCards, data.creditCards),
    ])

    // A period's corrected dates are unique per card ([cardId+period]): an
    // incoming row for a period this device already corrected — even under
    // another id — loses, same "local wins" rule as everything else.
    const localPeriods = new Set((await db.cardStatements.toArray()).flatMap((s) => [s.id, `${s.cardId}:${s.period}`]))
    // Nor may it move the close of a statement this device already paid
    // (or the one before it) — same rule as correcting dates in the app.
    const localPayments = await db.statementPayments.toArray()
    const paidStatements = new Set(localPayments.map((p) => `${p.cardId}:${p.period}`))
    const newStatements = data.cardStatements.filter((s) => {
      if (localPeriods.has(s.id) || localPeriods.has(`${s.cardId}:${s.period}`)) return false
      if (paidStatements.has(`${s.cardId}:${s.period}`) || paidStatements.has(`${s.cardId}:${shiftMonth(s.period, 1)}`)) {
        return false
      }
      localPeriods.add(`${s.cardId}:${s.period}`)
      return true
    })
    // New corrected dates for a card change where its automatically placed
    // gastos belong — same re-placement as correcting them in the app,
    // otherwise those gastos would look "pinned by hand" from then on.
    const touchedCards = [...new Set(newStatements.map((s) => s.cardId))]
    const calendarsBefore = new Map<string, CardCalendar>()
    for (const cardId of touchedCards) calendarsBefore.set(cardId, await getCardCalendar(cardId))
    if (newStatements.length > 0) await db.cardStatements.bulkAdd(newStatements)
    for (const [cardId, before] of calendarsBefore) {
      await reassignCardExpenses(cardId, before, await getCardCalendar(cardId))
    }
    const cardStatements: MergeCounts = {
      added: newStatements.length,
      skipped: data.cardStatements.length - newStatements.length,
    }

    // A statement is paid as a whole (one payment per currency): one this
    // device already paid in any currency keeps its local payments and
    // skips every incoming one — local wins, and a statement never ends up
    // with payments from two devices.
    const localPaymentIds = new Set(localPayments.map((p) => p.id))
    const newPayments = data.statementPayments.filter(
      (p) => !localPaymentIds.has(p.id) && !paidStatements.has(`${p.cardId}:${p.period}`),
    )
    for (const payment of newPayments) {
      const account = await db.accounts.get(payment.accountId)
      if (!account) throw new Error(`Pago de resumen (${payment.id}): la cuenta ${payment.accountId} no existe`)
      const problem = statementPaymentProblem(payment, account)
      if (problem) throw new Error(`Pago de resumen (${payment.id}): ${problem} (en tu base local)`)
      if (!(await db.creditCards.get(payment.cardId))) {
        throw new Error(`Pago de resumen (${payment.id}): la tarjeta ${payment.cardId} no existe`)
      }
    }
    if (newPayments.length > 0) await db.statementPayments.bulkAdd(newPayments)
    const statementPayments: MergeCounts = {
      added: newPayments.length,
      skipped: data.statementPayments.length - newPayments.length,
    }

    if (data.settings && !(await db.settings.get('singleton'))) {
      await db.settings.add(data.settings)
    }

    const localExpenses = await db.expenses.toArray()
    const existingExpenseIds = new Set(localExpenses.map((e) => e.id))
    const existingOccurrenceKeys = new Set(
      localExpenses
        .filter((e) => e.sourcePlanId !== undefined)
        .map((e) => `${e.sourcePlanId}:${e.date}`),
    )
    // Accept-as-we-go (not a plain .filter over a fixed snapshot) so that
    // two different expense ids for the SAME occurrence *within the same
    // incoming file* — only reachable via a corrupted/hand-edited backup,
    // since materializeDue() itself never writes an occurrence twice —
    // can't both slip through by each independently missing the other in
    // a filter taken before either was accepted.
    const newExpenses = data.expenses.filter((e) => {
      if (existingExpenseIds.has(e.id)) return false
      if (e.sourcePlanId !== undefined) {
        const key = `${e.sourcePlanId}:${e.date}`
        if (existingOccurrenceKeys.has(key)) return false
        existingOccurrenceKeys.add(key)
      }
      return true
    })
    if (newExpenses.length > 0) await db.expenses.bulkAdd(newExpenses)

    await assertMergedMovementsFit({
      incomes: incomes.added,
      expenses: newExpenses,
      adjustments: accountAdjustments.added,
      transfers: transfers.added,
      investmentLots: investmentLots.added,
      installmentPlans: installmentPlans.added,
      recurringPlans: recurringPlans.added,
    })
    const expenses: MergeCounts = {
      added: newExpenses.length,
      skipped: data.expenses.length - newExpenses.length,
    }

    const allPlans = await db.recurringPlans.toArray()
    await Promise.all(
      allPlans.map(async (plan) => {
        const planExpenses = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
        if (planExpenses.length === 0) return
        const latestDate = planExpenses.reduce((max, e) => (e.date > max ? e.date : max), '')
        if (!plan.lastMaterializedDate || latestDate > plan.lastMaterializedDate) {
          await db.recurringPlans.update(plan.id, { lastMaterializedDate: latestDate })
        }
      }),
    )

    return {
      categories: { added: categories.added.length, skipped: categories.skipped },
      expenses,
      recurringPlans: { added: recurringPlans.added.length, skipped: recurringPlans.skipped },
      installmentPlans: { added: installmentPlans.added.length, skipped: installmentPlans.skipped },
      budgets: { added: budgets.added.length, skipped: budgets.skipped },
      exchangeRates: { added: exchangeRates.added.length, skipped: exchangeRates.skipped },
      savingsHoldings: { added: savingsHoldings.added.length, skipped: savingsHoldings.skipped },
      investmentAssets: { added: investmentAssets.added.length, skipped: investmentAssets.skipped },
      investmentHoldings: { added: investmentHoldings.added.length, skipped: investmentHoldings.skipped },
      assetPrices: { added: assetPrices.added.length, skipped: assetPrices.skipped },
      investmentLots: { added: investmentLots.added.length, skipped: investmentLots.skipped },
      accounts: { added: accounts.added.length, skipped: accounts.skipped },
      incomes: { added: incomes.added.length, skipped: incomes.skipped },
      accountAdjustments: { added: accountAdjustments.added.length, skipped: accountAdjustments.skipped },
      transfers: { added: transfers.added.length, skipped: transfers.skipped },
      creditCards: { added: creditCards.added.length, skipped: creditCards.skipped },
      cardStatements,
      statementPayments,
    }
  })
}
