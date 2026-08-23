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
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.categories,
      db.transactions,
      db.postings,
      db.recurringPlans,
      db.installmentPlans,
      db.budgets,
      db.exchangeRates,
      db.settings,
    ],
    async () => {
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
    },
  )
}
