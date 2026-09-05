import Dexie, { type EntityTable } from 'dexie'
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
import { generateId } from '@/lib/ids'

// Tipos sólo para leer, durante el .upgrade() de la versión 4, las filas
// legacy de `transactions`/`postings`/`accounts` — esas entidades ya no
// existen en el dominio (ver ADR "Simplificación: se elimina Cuentas,
// Ingresos y Transferencias" en docs/DECISIONS.md), así que no hay un
// tipo importable para ellas. Sólo se usan acá adentro, para esta
// migración puntual.
interface LegacyPosting {
  id: string
  transactionId: string
  target: 'account' | 'category'
  accountId?: string
  categoryId?: string
  amount: number
  currency: string
}
interface LegacyTransaction {
  id: string
  date: string
  kind: 'income' | 'expense' | 'transfer' | 'adjustment' | 'investment'
  description: string
  notes?: string
  tags?: string[]
  status: 'confirmed' | 'projected'
  sourcePlanId?: string
  occurrenceIndex?: number
  createdAt: string
  updatedAt: string
}

/**
 * IndexedDB is the source of truth during normal use. The `.finance`
 * backup file (see features/backups) is a point-in-time snapshot, not a
 * synced copy — see docs/ARCHITECTURE.md.
 *
 * Schema versions here are additive-only: never rename/remove a field
 * or reorder `.version()` calls once shipped. See docs/DATA_MODEL.md.
 */
export class MonetaDatabase extends Dexie {
  categories!: EntityTable<Category, 'id'>
  expenses!: EntityTable<Expense, 'id'>
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
    // Simplificación de fondo: se elimina el ledger de partida doble
    // (Account/Transaction/Posting) — ver ADR "Simplificación: se elimina
    // Cuentas, Ingresos y Transferencias" en docs/DECISIONS.md. Un gasto
    // pasa a ser un registro plano (`expenses`, sin cuenta ni pata que
    // balancear). Categorías dejan de tener `kind` (sin ingreso, sólo
    // existe un tipo). Este .upgrade() reconstruye `expenses` a partir de
    // cada Transaction kind:'expense' + su posting de categoría — todo lo
    // demás (income/transfer/adjustment/investment, sus postings, y las
    // cuentas mismas) se descarta: es un borrado real y deliberado,
    // decidido explícitamente por el usuario, no un accidente de
    // migración. `accounts`/`postings`/`transactions` se eliminan del
    // todo (`null`); no queda ninguna tabla legacy colgando.
    this.version(4)
      .stores({
        accounts: null,
        postings: null,
        transactions: null,
        categories: 'id, name, parentId, isArchived, order',
        expenses: 'id, date, categoryId, status, sourcePlanId, [status+date]',
      })
      .upgrade(async (tx) => {
        const transactions = await tx.table<LegacyTransaction>('transactions').toArray()
        const postings = await tx.table<LegacyPosting>('postings').toArray()
        const postingsByTransactionId = new Map<string, LegacyPosting[]>()
        for (const posting of postings) {
          const list = postingsByTransactionId.get(posting.transactionId) ?? []
          list.push(posting)
          postingsByTransactionId.set(posting.transactionId, list)
        }

        const expenses: Expense[] = []
        for (const transaction of transactions) {
          if (transaction.kind !== 'expense') continue
          const categoryPosting = postingsByTransactionId
            .get(transaction.id)
            ?.find((p) => p.target === 'category')
          // No debería poder pasar (todo gasto tiene su pata de categoría),
          // pero un .upgrade() corre sobre datos reales y nunca debe tirar
          // por un dato inconsistente — se descarta esa fila puntual.
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
        await tx.table('expenses').bulkAdd(expenses)

        // Categorías de ingreso ya no tienen sentido (sin `kind`, no hay
        // forma de distinguirlas) — se borran directo en vez de dejarlas
        // como gastos huérfanos. `DEFAULT_CATEGORIES` en categories.repo.ts
        // ya no las siembra para una base nueva.
        const categories = await tx.table<{ id: string; kind?: string }>('categories').toArray()
        const incomeCategoryIds = categories.filter((c) => c.kind === 'income').map((c) => c.id)
        if (incomeCategoryIds.length > 0) {
          await tx.table('categories').bulkDelete(incomeCategoryIds)
        }
      })
  }
}

export const db = new MonetaDatabase()
