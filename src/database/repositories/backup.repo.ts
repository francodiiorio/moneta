import type { EntityTable } from 'dexie'
import { db } from '../db'
import type {
  AssetPrice,
  Budget,
  Category,
  ExchangeRate,
  Expense,
  InstallmentPlan,
  InvestmentAsset,
  InvestmentHolding,
  InvestmentLot,
  RecurringPlan,
  SavingsHolding,
  Settings,
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
    ...(settings !== undefined && { settings }),
  }
}

/** Wipes every table and repopulates it from `data`, atomically. Used
 *  only by backup import — see features/backups/import.ts, which
 *  validates and migrates `data` before calling this. */
export async function replaceAllTables(data: AllTablesData): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    await Promise.all([
      db.categories.clear(),
      db.expenses.clear(),
      db.recurringPlans.clear(),
      db.installmentPlans.clear(),
      db.budgets.clear(),
      db.exchangeRates.clear(),
      db.settings.clear(),
      db.savingsHoldings.clear(),
      db.investmentAssets.clear(),
      db.investmentHoldings.clear(),
      db.assetPrices.clear(),
      db.investmentLots.clear(),
    ])
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
    ])

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
    }
  })
}
