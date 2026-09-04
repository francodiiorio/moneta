import { db } from '../db'
import type { InvestmentHolding, InvestmentLot } from '@/domain/entities'
import { aggregateLots } from '@/domain/investments'
import { quantity, valuePosition } from '@/domain/decimal'
import { buildInvestmentPurchase } from '@/domain/ledger'
import { money, type CurrencyCode } from '@/domain/money'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import type { DateStamp } from '@/lib/dates'
import { getOrCreateInvestmentCategory } from './categories.repo'
import { deleteTransaction, writeLedgerEntry } from './transactions.repo'

export interface CreateInvestmentLotInput {
  assetId: string
  quantity: InvestmentLot['quantity']
  costPerUnit?: InvestmentLot['costPerUnit']
  currency: CurrencyCode
  date: DateStamp
  notes?: string
  /** Cuenta desde la que se pagó — si viene, además del lote se escribe
   *  el movimiento del ledger (`kind: 'investment'`) que descuenta
   *  `quantity × costPerUnit` de esa cuenta, en la misma transacción
   *  Dexie que el lote, y su id queda en `lot.transactionId`. Exige
   *  `costPerUnit` (si no, no hay monto que descontar) y que la cuenta
   *  esté en la misma moneda que el activo — sin FX en esta versión. Ver
   *  ADR "Una compra de inversión no es un gasto" en docs/DECISIONS.md. */
  accountId?: string
}

/** `costPerUnit: null` clears it explicitly; omitted leaves it untouched;
 *  a value sets it. Needs its own tri-state (unlike `quantity`/`date`,
 *  which never go from "has a value" to "has none") because a lot can
 *  lose its cost the same way a holding's `averageCost` can — see
 *  `updateInvestmentLot` below. */
export type UpdateInvestmentLotInput = Partial<Pick<InvestmentLot, 'quantity' | 'date' | 'notes'>> & {
  costPerUnit?: InvestmentLot['costPerUnit'] | null
}

export async function listInvestmentLots(assetId: string): Promise<InvestmentLot[]> {
  return db.investmentLots.where('assetId').equals(assetId).sortBy('date')
}

export async function getInvestmentLot(id: string): Promise<InvestmentLot | undefined> {
  return db.investmentLots.get(id)
}

/** Recalculates and upserts (or deletes, if no lots remain) the cached
 *  `InvestmentHolding` aggregate for `assetId` from its `InvestmentLot`
 *  rows — the only place besides the domain layer itself that knows
 *  lots -> aggregate. Always the last step inside the same transaction
 *  as a lot write, so the aggregate never observes a partial lot set.
 *
 *  A full `put()`, not `update()`: `averageCost` can go from defined to
 *  undefined (e.g. the only costed lot just got deleted), and Dexie's
 *  `update()` can't remove a field that's simply absent from the patch —
 *  it leaves the old value in place. `put()` replaces the whole row, so
 *  there's no ambiguity. */
async function recomputeHoldingAggregate(assetId: string): Promise<void> {
  const lots = await db.investmentLots.where('assetId').equals(assetId).toArray()
  const existing = await db.investmentHoldings.where('assetId').equals(assetId).first()

  if (lots.length === 0) {
    if (existing) await db.investmentHoldings.delete(existing.id)
    return
  }

  const { quantity: totalQuantity, averageCost } = aggregateLots(
    lots.map((lot) => ({
      quantity: quantity(lot.quantity),
      ...(lot.costPerUnit !== undefined && { costPerUnit: money(lot.costPerUnit, lot.currency) }),
    })),
  )
  const now = new Date().toISOString()
  const holding: InvestmentHolding = {
    id: existing?.id ?? generateId(),
    assetId,
    quantity: totalQuantity,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(averageCost !== undefined && { averageCost }),
    ...(existing?.notes !== undefined && { notes: existing.notes }),
  }
  await db.investmentHoldings.put(holding)
}

export async function createInvestmentLot(input: CreateInvestmentLotInput): Promise<InvestmentLot> {
  return db.transaction(
    'rw',
    [db.investmentAssets, db.investmentHoldings, db.investmentLots, db.transactions, db.postings, db.accounts, db.categories],
    async () => {
      const asset = await db.investmentAssets.get(input.assetId)
      invariant(asset, `Activo no encontrado: ${input.assetId}`)
      // Defense in depth, same reasoning as investments.repo.ts's own
      // quantity check — the form already validates > 0 and passes the
      // asset's own currency, but a lot in the wrong currency would let
      // aggregateLots silently average costs across currencies.
      invariant(input.currency === asset.currency, `Moneda del lote (${input.currency}) no coincide con la del activo (${asset.currency})`)
      const validQuantity = quantity(input.quantity)

      let transactionId: string | undefined
      if (input.accountId !== undefined) {
        const account = await db.accounts.get(input.accountId)
        invariant(account, `Cuenta no encontrada: ${input.accountId}`)
        // Sin FX en esta versión: la cuenta de origen paga en la moneda
        // del activo o no paga — el formulario ya sólo ofrece cuentas de
        // esa moneda, esto es la defensa de último recurso.
        invariant(
          account.currency === input.currency,
          `La cuenta de origen está en ${account.currency} y la compra en ${input.currency}`,
        )
        invariant(
          input.costPerUnit !== undefined,
          'Para descontar la compra de una cuenta hace falta el costo por unidad',
        )

        const total = valuePosition(validQuantity, money(input.costPerUnit, input.currency))
        // Un costo explícito de cero (ver aggregateLots: "costed, not
        // missing") no tiene nada que descontar — el lote lo registra
        // igual, simplemente no se genera un movimiento de $0.
        if (total.amount > 0) {
          const category = await getOrCreateInvestmentCategory()
          transactionId = await writeLedgerEntry(
            buildInvestmentPurchase({
              date: input.date,
              description: `Compra ${asset.symbol ?? asset.name}`,
              accountId: input.accountId,
              categoryId: category.id,
              amount: total,
            }),
          )
        }
      }

      const now = new Date().toISOString()
      const lot: InvestmentLot = {
        id: generateId(),
        assetId: input.assetId,
        quantity: input.quantity,
        currency: input.currency,
        date: input.date,
        createdAt: now,
        updatedAt: now,
        ...(input.costPerUnit !== undefined && { costPerUnit: input.costPerUnit }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(transactionId !== undefined && { transactionId }),
      }
      await db.investmentLots.add(lot)
      await recomputeHoldingAggregate(input.assetId)
      return lot
    },
  )
}

/** A full `put()`, not `update()` — same reasoning as
 *  `recomputeHoldingAggregate`: `costPerUnit` can go from defined to
 *  absent (the user clears "Costo por unidad" on an already-costed lot),
 *  and Dexie's `update()` can't remove a field that's simply missing
 *  from the patch, it leaves the old value in place. `patch.costPerUnit`
 *  is therefore tri-state — see `UpdateInvestmentLotInput`.
 *
 *  If the lot has a `transactionId` (a cuenta de origen was chosen when
 *  it was created) and this patch touches `quantity`, `costPerUnit` or
 *  `date`, the linked movement is resynced in place (same amount/date
 *  recalculation, same transaction id — `writeLedgerEntry`'s
 *  `existingId` path replaces its postings wholesale). This is
 *  deliberate: leaving the movement stale would silently defeat the
 *  whole point of linking it in the first place. The account/category
 *  legs themselves are never touched — only a full delete+recreate of
 *  the lot changes which account paid for a purchase.
 *
 *  If the recalculated total lands on exactly zero (quantity or cost
 *  edited down to make one), the linked movement is deleted and
 *  `transactionId` cleared instead of writing a $0-postings movement —
 *  same "nothing to deduct" rule `createInvestmentLot` already applies,
 *  kept consistent here so an edit can't leave behind an unreachable
 *  zero-amount transaction (no "Editar" from Movimientos for a kind:
 *  'investment' row). */
export async function updateInvestmentLot(id: string, patch: UpdateInvestmentLotInput): Promise<void> {
  await db.transaction(
    'rw',
    [db.investmentHoldings, db.investmentLots, db.transactions, db.postings, db.categories, db.accounts],
    async () => {
      const lot = await db.investmentLots.get(id)
      invariant(lot, `Compra no encontrada: ${id}`)
      if (patch.quantity !== undefined) quantity(patch.quantity)

      const updated: InvestmentLot = {
        ...lot,
        ...(patch.quantity !== undefined && { quantity: patch.quantity }),
        ...(patch.date !== undefined && { date: patch.date }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        updatedAt: new Date().toISOString(),
      }
      if (patch.costPerUnit === null) {
        delete updated.costPerUnit
      } else if (patch.costPerUnit !== undefined) {
        updated.costPerUnit = patch.costPerUnit
      }

      const touchesLinkedTransaction = patch.quantity !== undefined || patch.costPerUnit !== undefined || patch.date !== undefined
      if (lot.transactionId !== undefined && touchesLinkedTransaction) {
        invariant(
          updated.costPerUnit !== undefined,
          'No se puede vaciar el costo de una compra con un movimiento vinculado — para desvincularla, borrala y volvela a cargar',
        )
        const total = valuePosition(quantity(updated.quantity), money(updated.costPerUnit, updated.currency))
        if (total.amount > 0) {
          const [existingTransaction, accountPosting] = await Promise.all([
            db.transactions.get(lot.transactionId),
            db.postings
              .where('transactionId')
              .equals(lot.transactionId)
              .and((p) => p.target === 'account')
              .first(),
          ])
          invariant(existingTransaction, `Movimiento vinculado no encontrado: ${lot.transactionId}`)
          invariant(accountPosting?.accountId, `El movimiento vinculado ${lot.transactionId} no tiene una pata de cuenta`)

          const category = await getOrCreateInvestmentCategory()
          await writeLedgerEntry(
            buildInvestmentPurchase({
              date: updated.date,
              description: existingTransaction.description,
              accountId: accountPosting.accountId,
              categoryId: category.id,
              amount: total,
            }),
            lot.transactionId,
          )
        } else {
          // El nuevo costo (o la nueva cantidad) llevó el total a
          // exactamente cero — mismo criterio que createInvestmentLot:
          // nada que descontar. En vez de dejar un movimiento fantasma
          // con postings en $0 (que nunca se puede editar ni limpiar
          // solo, ver editableKind en TransactionsPage.tsx), se borra y
          // se desvincula el lote.
          await deleteTransaction(lot.transactionId)
          delete updated.transactionId
        }
      }

      await db.investmentLots.put(updated)
      await recomputeHoldingAggregate(lot.assetId)
    },
  )
}

/** `deleteLinkedTransaction` (default false) borra además el movimiento
 *  que generó la compra — mismo shape opt-in que
 *  `recurringPlans.repo.ts:deleteRecurringPlan`: borrar historia
 *  financiera real siempre es una elección explícita del usuario, nunca
 *  el default. Si el movimiento ya no existe (por ejemplo, borrado a
 *  mano desde Movimientos), `deleteTransaction` es un no-op. */
export async function deleteInvestmentLot(
  id: string,
  options?: { deleteLinkedTransaction?: boolean },
): Promise<void> {
  await db.transaction('rw', db.investmentHoldings, db.investmentLots, db.transactions, db.postings, async () => {
    const lot = await db.investmentLots.get(id)
    if (!lot) return
    if (options?.deleteLinkedTransaction && lot.transactionId !== undefined) {
      await deleteTransaction(lot.transactionId)
    }
    await db.investmentLots.delete(id)
    await recomputeHoldingAggregate(lot.assetId)
  })
}
