import type { EntityTable } from 'dexie'
import { db } from '../db'
import type {
  Account,
  Budget,
  Category,
  ExchangeRate,
  InstallmentPlan,
  Posting,
  RecurringPlan,
  Settings,
  Transaction,
} from '@/domain/entities'

export interface AllTablesData {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  postings: Posting[]
  recurringPlans: RecurringPlan[]
  installmentPlans: InstallmentPlan[]
  budgets: Budget[]
  exchangeRates: ExchangeRate[]
  settings?: Settings | undefined
}

/** Every table a full backup touches — shared by replaceAllTables and
 *  mergeAllTables so a future table addition can't update one and miss
 *  the other's transaction scope. */
function allTables() {
  return [
    db.accounts,
    db.categories,
    db.transactions,
    db.postings,
    db.recurringPlans,
    db.installmentPlans,
    db.budgets,
    db.exchangeRates,
    db.settings,
  ] as const
}

export async function readAllTables(): Promise<AllTablesData> {
  const [
    accounts,
    categories,
    transactions,
    postings,
    recurringPlans,
    installmentPlans,
    budgets,
    exchangeRates,
    settings,
  ] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.postings.toArray(),
    db.recurringPlans.toArray(),
    db.installmentPlans.toArray(),
    db.budgets.toArray(),
    db.exchangeRates.toArray(),
    db.settings.get('singleton'),
  ])
  return {
    accounts,
    categories,
    transactions,
    postings,
    recurringPlans,
    installmentPlans,
    budgets,
    exchangeRates,
    ...(settings !== undefined && { settings }),
  }
}

/** Wipes every table and repopulates it from `data`, atomically. Used
 *  only by backup import — see features/backups/import.ts, which
 *  validates and migrates `data` before calling this. */
export async function replaceAllTables(data: AllTablesData): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    await Promise.all([
      db.accounts.clear(),
      db.categories.clear(),
      db.transactions.clear(),
      db.postings.clear(),
      db.recurringPlans.clear(),
      db.installmentPlans.clear(),
      db.budgets.clear(),
      db.exchangeRates.clear(),
      db.settings.clear(),
    ])
    await Promise.all([
      db.accounts.bulkAdd(data.accounts),
      db.categories.bulkAdd(data.categories),
      db.transactions.bulkAdd(data.transactions),
      db.postings.bulkAdd(data.postings),
      db.recurringPlans.bulkAdd(data.recurringPlans),
      db.installmentPlans.bulkAdd(data.installmentPlans),
      db.budgets.bulkAdd(data.budgets),
      db.exchangeRates.bulkAdd(data.exchangeRates),
      data.settings ? db.settings.add(data.settings) : Promise.resolve(),
    ])
  })
}

export interface MergeCounts {
  /** Rows that were new and got written. */
  added: number
  /** Rows the file had for this table that were already present locally
   *  (by id, or — for transactions — by the occurrence they represent)
   *  and were left untouched. Lets the UI say "you already had N of
   *  these" instead of guessing from a zero `added` count, which could
   *  also just mean the file had none of that kind at all. */
  skipped: number
}

export interface MergeSummary {
  accounts: MergeCounts
  categories: MergeCounts
  transactions: MergeCounts
  recurringPlans: MergeCounts
  installmentPlans: MergeCounts
  budgets: MergeCounts
  exchangeRates: MergeCounts
}

/** Adds only the rows of `incoming` whose id isn't already present in
 *  `table` — existing rows are never overwritten. Returns the rows that
 *  were actually added (so callers needing that subset, like postings
 *  gated by their transaction, don't have to re-derive it) alongside how
 *  many were skipped as already-present. */
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
 * `transactions` are deduplicated by id AND, when `sourcePlanId` +
 * `occurrenceIndex` are set, by that pair too. A `RecurringPlan` that
 * already existed on both devices before they diverged gets its
 * occurrences materialized independently by each device's own
 * `materializeDue()` — same calendar occurrence, but `generateId()`
 * (lib/ids.ts) is random, so the two devices produce different
 * transaction ids for it. Deduplicating by id alone would treat them as
 * unrelated and add both, silently double-counting that expense in the
 * account's balance — exactly the scenario this feature exists to
 * consolidate safely.
 *
 * `postings` are gated by their transaction, not merged independently by
 * their own id: a posting whose transaction already exists locally is
 * skipped even if that exact posting id isn't present, because editing a
 * transaction (`transactions.repo.ts:writeLedgerEntry`) replaces its
 * postings wholesale while keeping the transaction's id — an older
 * backup's postings for an already-edited transaction would otherwise
 * re-add stale amounts alongside the current ones.
 *
 * After merging, every `RecurringPlan` left in the table (existing or
 * newly added) gets its `lastMaterializedDate` repaired to the latest
 * date actually materialized for it locally. Without this,
 * `materializeDue()` (features/plans/service.ts) — which trusts that
 * watermark blindly to decide what's still due — would treat occurrences
 * merged in from another device as not-yet-materialized and generate
 * duplicate transactions for them the next time the app opens.
 */
export async function mergeAllTables(data: AllTablesData): Promise<MergeSummary> {
  return db.transaction('rw', allTables(), async () => {
    const [accounts, categories, recurringPlans, installmentPlans, budgets, exchangeRates] = await Promise.all([
      addMissing(db.accounts, data.accounts),
      addMissing(db.categories, data.categories),
      addMissing(db.recurringPlans, data.recurringPlans),
      addMissing(db.installmentPlans, data.installmentPlans),
      addMissing(db.budgets, data.budgets),
      addMissing(db.exchangeRates, data.exchangeRates),
    ])

    if (data.settings && !(await db.settings.get('singleton'))) {
      await db.settings.add(data.settings)
    }

    const localTransactions = await db.transactions.toArray()
    const existingTransactionIds = new Set(localTransactions.map((t) => t.id))
    const existingOccurrenceKeys = new Set(
      localTransactions
        .filter((t) => t.sourcePlanId !== undefined && t.occurrenceIndex !== undefined)
        .map((t) => `${t.sourcePlanId}:${t.occurrenceIndex}`),
    )
    // Accept-as-we-go (not a plain .filter over a fixed snapshot) so that
    // two different transaction ids for the SAME occurrence *within the
    // same incoming file* — only reachable via a corrupted/hand-edited
    // backup, since materializeDue() itself never writes an occurrence
    // twice — can't both slip through by each independently missing the
    // other in a filter taken before either was accepted.
    const newTransactions = data.transactions.filter((t) => {
      if (existingTransactionIds.has(t.id)) return false
      if (t.sourcePlanId !== undefined && t.occurrenceIndex !== undefined) {
        const key = `${t.sourcePlanId}:${t.occurrenceIndex}`
        if (existingOccurrenceKeys.has(key)) return false
        existingOccurrenceKeys.add(key)
      }
      return true
    })
    if (newTransactions.length > 0) await db.transactions.bulkAdd(newTransactions)
    const transactions: MergeCounts = {
      added: newTransactions.length,
      skipped: data.transactions.length - newTransactions.length,
    }

    const addedTransactionIds = new Set(newTransactions.map((t) => t.id))
    const newPostings = data.postings.filter((p) => addedTransactionIds.has(p.transactionId))
    if (newPostings.length > 0) await db.postings.bulkAdd(newPostings)

    const allPlans = await db.recurringPlans.toArray()
    await Promise.all(
      allPlans.map(async (plan) => {
        const planTransactions = await db.transactions.where('sourcePlanId').equals(plan.id).toArray()
        if (planTransactions.length === 0) return
        const latestDate = planTransactions.reduce((max, t) => (t.date > max ? t.date : max), '')
        if (!plan.lastMaterializedDate || latestDate > plan.lastMaterializedDate) {
          await db.recurringPlans.update(plan.id, { lastMaterializedDate: latestDate })
        }
      }),
    )

    return {
      accounts: { added: accounts.added.length, skipped: accounts.skipped },
      categories: { added: categories.added.length, skipped: categories.skipped },
      transactions,
      recurringPlans: { added: recurringPlans.added.length, skipped: recurringPlans.skipped },
      installmentPlans: { added: installmentPlans.added.length, skipped: installmentPlans.skipped },
      budgets: { added: budgets.added.length, skipped: budgets.skipped },
      exchangeRates: { added: exchangeRates.added.length, skipped: exchangeRates.skipped },
    }
  })
}
