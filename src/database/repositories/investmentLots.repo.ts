import Dexie from 'dexie'
import { db } from '../db'
import type { InvestmentHolding, InvestmentLot } from '@/domain/entities'
import { aggregateLots } from '@/domain/investments'
import { quantity } from '@/domain/decimal'
import { movementAccountProblem } from '@/domain/accounts'
import { money, type CurrencyCode } from '@/domain/money'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import type { DateStamp } from '@/lib/dates'

/** The account a purchase was paid from (Etapa 8, Fase 3). `amount` is
 *  what was actually debited, in the account's own currency, positive.
 *  `expectedCurrency` is the currency the caller parsed `amount` in —
 *  checked against the account inside the write transaction, same reason
 *  as transfers.repo.ts: a bare integer means a different amount if the
 *  account's currency changed in between. */
export interface LotSourceInput {
  accountId: string
  amount: number
  expectedCurrency: string
}

export interface CreateInvestmentLotInput {
  assetId: string
  quantity: InvestmentLot['quantity']
  costPerUnit?: InvestmentLot['costPerUnit']
  currency: CurrencyCode
  date: DateStamp
  notes?: string
  source?: LotSourceInput
}

/** `costPerUnit: null` clears it explicitly; omitted leaves it untouched;
 *  a value sets it. Needs its own tri-state (unlike `quantity`/`date`,
 *  which never go from "has a value" to "has none") because a lot can
 *  lose its cost the same way a holding's `averageCost` can — see
 *  `updateInvestmentLot` below. */
export type UpdateInvestmentLotInput = Partial<Pick<InvestmentLot, 'quantity' | 'date' | 'notes'>> & {
  costPerUnit?: InvestmentLot['costPerUnit'] | null
  /** Same tri-state as `costPerUnit`: `null` removes the source account
   *  (the purchase stops debiting it), omitted leaves it as is. */
  source?: LotSourceInput | null
}

/** Sets or clears the source-account fields of `lot` in place, after
 *  checking the account accepts a debit on `lot.date` (same currency
 *  rules as any account movement). Must run inside a transaction that
 *  covers `db.accounts`. Re-run on every write that keeps a source, even
 *  one that only moves the date: the new date could fall before the
 *  account's opening date. */
async function applySource(lot: InvestmentLot, source: LotSourceInput | null): Promise<void> {
  if (source === null) {
    delete lot.sourceAccountId
    delete lot.sourceAmount
    delete lot.sourceCurrency
    return
  }
  invariant(Number.isInteger(source.amount) && source.amount > 0, 'El monto debitado tiene que ser mayor a cero')
  const account = await db.accounts.get(source.accountId)
  invariant(account, `Cuenta no encontrada: ${source.accountId}`)
  invariant(
    account.currency === source.expectedCurrency,
    'La moneda de la cuenta cambió mientras cargabas la compra — volvé a intentarlo',
  )
  const problem = movementAccountProblem(account, { date: lot.date, currency: account.currency })
  invariant(problem === undefined, problem ?? '')
  lot.sourceAccountId = account.id
  lot.sourceAmount = source.amount
  lot.sourceCurrency = account.currency
}

function currentSource(lot: InvestmentLot): LotSourceInput | null {
  if (lot.sourceAccountId === undefined || lot.sourceAmount === undefined || lot.sourceCurrency === undefined) {
    return null
  }
  return { accountId: lot.sourceAccountId, amount: lot.sourceAmount, expectedCurrency: lot.sourceCurrency }
}

export async function listInvestmentLots(assetId: string): Promise<InvestmentLot[]> {
  return db.investmentLots.where('assetId').equals(assetId).sortBy('date')
}

/** Every purchase paid from an account — the net worth history needs
 *  them to avoid valuing money twice (see domain/investments:holdingsAsOf). */
export async function listLotsWithSource(): Promise<InvestmentLot[]> {
  return db.investmentLots.where('sourceAccountId').above(Dexie.minKey).toArray()
}

/** Purchases in `[startDate, endDate]` that were paid from an account —
 *  the ones that move a balance, listed in Movimientos. */
export async function listLotsWithSourceInRange(startDate: string, endDate: string): Promise<InvestmentLot[]> {
  return db.investmentLots
    .where('date')
    .between(startDate, endDate, true, true)
    .filter((lot) => lot.sourceAccountId !== undefined)
    .toArray()
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
  const tables = [db.investmentAssets, db.investmentHoldings, db.investmentLots, db.accounts]
  return db.transaction('rw', tables, async () => {
    const asset = await db.investmentAssets.get(input.assetId)
    invariant(asset, `Activo no encontrado: ${input.assetId}`)
    // Defense in depth, same reasoning as investments.repo.ts's own
    // quantity check — the form already validates > 0 and passes the
    // asset's own currency, but a lot in the wrong currency would let
    // aggregateLots silently average costs across currencies.
    invariant(input.currency === asset.currency, `Moneda del lote (${input.currency}) no coincide con la del activo (${asset.currency})`)
    quantity(input.quantity)

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
    }
    if (input.source !== undefined) await applySource(lot, input.source)
    await db.investmentLots.add(lot)
    await recomputeHoldingAggregate(input.assetId)
    return lot
  })
}

/** A full `put()`, not `update()` — same reasoning as
 *  `recomputeHoldingAggregate`: `costPerUnit` can go from defined to
 *  absent (the user clears "Costo por unidad" on an already-costed lot),
 *  and Dexie's `update()` can't remove a field that's simply missing
 *  from the patch, it leaves the old value in place. `patch.costPerUnit`
 *  is therefore tri-state — see `UpdateInvestmentLotInput`. */
export async function updateInvestmentLot(id: string, patch: UpdateInvestmentLotInput): Promise<void> {
  await db.transaction('rw', db.investmentHoldings, db.investmentLots, db.accounts, async () => {
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
    await applySource(updated, patch.source !== undefined ? patch.source : currentSource(lot))

    await db.investmentLots.put(updated)
    await recomputeHoldingAggregate(lot.assetId)
  })
}

export async function deleteInvestmentLot(id: string): Promise<void> {
  await db.transaction('rw', db.investmentHoldings, db.investmentLots, async () => {
    const lot = await db.investmentLots.get(id)
    if (!lot) return
    await db.investmentLots.delete(id)
    await recomputeHoldingAggregate(lot.assetId)
  })
}
