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
  InvestmentLot,
  Posting,
  RecurringPlan,
  SavingsHolding,
  Settings,
  Transaction,
} from '@/domain/entities'
import { generateId } from '@/lib/ids'

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
  investmentLots!: EntityTable<InvestmentLot, 'id'>

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
    // Tracking de inversiones por lote — ver ADR "Tracking de inversiones
    // por lote" en docs/DECISIONS.md. InvestmentHolding.quantity/averageCost
    // pasan a ser un agregado cacheado de sus InvestmentLot, nunca editado
    // a mano — este .upgrade() le crea un lote heredado a cada holding que
    // ya existía, para que de acá en más todo holding tenga siempre ≥1 lote.
    this.version(3)
      .stores({ investmentLots: 'id, assetId, date' })
      .upgrade(async (tx) => {
        const holdings = await tx.table<InvestmentHolding>('investmentHoldings').toArray()
        const assets = await tx.table<InvestmentAsset>('investmentAssets').toArray()
        const assetById = new Map(assets.map((a) => [a.id, a]))
        const lots: InvestmentLot[] = holdings
          .filter((h) => h.quantity > 0)
          .map((h) => ({
            id: generateId(),
            assetId: h.assetId,
            quantity: h.quantity,
            // Un holding sin su asset no debería existir (deleteInvestmentAsset
            // lo bloquea), pero un .upgrade() corre sobre datos reales de
            // producción y nunca debe poder tirar por un dato inconsistente.
            currency: assetById.get(h.assetId)?.currency ?? 'ARS',
            date: h.createdAt.slice(0, 10),
            createdAt: h.createdAt,
            updatedAt: h.createdAt,
            ...(h.averageCost !== undefined && { costPerUnit: h.averageCost }),
          }))
        await tx.table('investmentLots').bulkAdd(lots)
      })
  }
}

export const db = new MonetaDatabase()
