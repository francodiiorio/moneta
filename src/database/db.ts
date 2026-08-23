import Dexie, { type EntityTable } from 'dexie'
import type {
  Account,
  AssetPrice,
  Budget,
  Category,
  ExchangeRate,
  InstallmentPlan,
  InvestmentAsset,
  InvestmentHolding,
  Posting,
  RecurringPlan,
  SavingsHolding,
  Settings,
  Transaction,
} from '@/domain/entities'

/**
 * IndexedDB is the source of truth during normal use. The `.finance`
 * backup file (see features/backups) is a point-in-time snapshot, not a
 * synced copy — see docs/ARCHITECTURE.md.
 *
 * Schema versions here are additive-only: never rename/remove a field
 * or reorder `.version()` calls once shipped. See docs/DATA_MODEL.md.
 */
export class MonetaDatabase extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  categories!: EntityTable<Category, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  postings!: EntityTable<Posting, 'id'>
  recurringPlans!: EntityTable<RecurringPlan, 'id'>
  installmentPlans!: EntityTable<InstallmentPlan, 'id'>
  budgets!: EntityTable<Budget, 'id'>
  exchangeRates!: EntityTable<ExchangeRate, 'id'>
  settings!: EntityTable<Settings, 'id'>
  savingsHoldings!: EntityTable<SavingsHolding, 'id'>
  investmentAssets!: EntityTable<InvestmentAsset, 'id'>
  investmentHoldings!: EntityTable<InvestmentHolding, 'id'>
  assetPrices!: EntityTable<AssetPrice, 'id'>

  constructor(name = 'moneta') {
    super(name)
    this.version(1).stores({
      accounts: 'id, name, type, currency, isArchived, order',
      categories: 'id, name, kind, parentId, isArchived, order',
      transactions: 'id, date, kind, status, sourcePlanId, [status+date], [kind+date]',
      postings: 'id, transactionId, [accountId+date], [categoryId+date], date',
      recurringPlans: 'id, isPaused, lastMaterializedDate',
      installmentPlans: 'id, accountId, firstDueDate',
      budgets: 'id, categoryId, [categoryId+startsOn]',
      exchangeRates: 'id, [from+to+date], date',
      settings: 'id',
    })
    // Patrimonio: ahorros e inversiones — todas nacen vacías, no hace
    // falta .upgrade(). Ver docs/DATA_MODEL.md "Versionado".
    this.version(2).stores({
      savingsHoldings: 'id, currency',
      investmentAssets: 'id, type, symbol',
      investmentHoldings: 'id, assetId',
      assetPrices: 'id, [assetId+date], assetId, date',
    })
  }
}

export const db = new MonetaDatabase()
