import { db } from '../db'
import type { CreditCard } from '@/domain/entities'
import {
  installmentPlacement,
  lastPurchaseDay,
  openingBalancesProblem,
  reassignedPeriods,
  statementDates,
  statementPeriodFor,
  type CardCalendar,
} from '@/domain/cards'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { todayStamp } from '@/lib/dates'

export interface CreditCardInput {
  name: string
  closingDay: number
  dueDay: number
  /** See CreditCard.closingDayToNext. */
  closingDayToNext?: boolean
  /** See CreditCard.openingBalances / openingBase. Empty or absent = none. */
  openingBalances?: CreditCard['openingBalances']
  openingBase?: CreditCard['openingBase']
  notes?: string
}

function assertOpening(input: Pick<CreditCardInput, 'openingBalances' | 'openingBase'>): void {
  const problem = openingBalancesProblem(input.openingBalances ?? [], input.openingBase)
  invariant(problem === undefined, problem ?? '')
}

function assertDays(input: Pick<CreditCardInput, 'closingDay' | 'dueDay'>): void {
  for (const day of [input.closingDay, input.dueDay]) {
    invariant(Number.isInteger(day) && day >= 1 && day <= 31, `Día inválido: ${day}`)
  }
}

export async function listCreditCards(): Promise<CreditCard[]> {
  return db.creditCards.orderBy('order').toArray()
}

export async function getCreditCard(id: string): Promise<CreditCard | undefined> {
  return db.creditCards.get(id)
}

/** The card plus its hand-corrected periods — what domain/cards needs to
 *  place a purchase. Must run inside a transaction covering
 *  `db.creditCards` and `db.cardStatements` when called from a write. */
export async function getCardCalendar(cardId: string): Promise<CardCalendar> {
  const [card, overrides] = await Promise.all([
    db.creditCards.get(cardId),
    db.cardStatements.where('cardId').equals(cardId).toArray(),
  ])
  invariant(card, `Tarjeta no encontrada: ${cardId}`)
  return { card, overrides }
}

/**
 * Re-places the card's gastos after its calendar changed (an override
 * added/edited/removed, or new default days), in the caller's transaction
 * (which must cover `db.expenses` and `db.installmentPlans`). Returns how
 * many moved.
 *
 * - Cuotas of a card installment plan follow their own rule
 *   (domain/cards:installmentPlacement — purchase's statement + i, dated
 *   within it), recomputed with the new calendar; only ones whose
 *   statement is still open move, a closed one was already billed.
 * - Everything else: only the ones that were where automatic placement
 *   put them under the old calendar move (domain/cards:reassignedPeriods);
 *   the ones pinned by hand stay.
 */
/** Marks the gastos statement reconciliation creates: the bank's charges
 *  of THAT statement, so they never move to another one. */
export const STATEMENT_RECONCILE_TAG = 'conciliacion-resumen'

export async function reassignCardExpenses(cardId: string, before: CardCalendar, after: CardCalendar): Promise<number> {
  const today = todayStamp()
  const now = new Date().toISOString()
  const expenses = await db.expenses.where('cardId').equals(cardId).toArray()
  const cardPlans = new Map((await db.installmentPlans.filter((p) => p.cardId === cardId).toArray()).map((p) => [p.id, p]))

  let moved = 0
  const others = []
  for (const expense of expenses) {
    // A reconciliation charge stays in its statement, dated at its last
    // purchase day — wherever that moves (a later date would be past it).
    if (expense.tags?.includes(STATEMENT_RECONCILE_TAG) && expense.statementPeriod !== undefined) {
      const last = lastPurchaseDay(after, expense.statementPeriod)
      if (last !== expense.date) await db.expenses.update(expense.id, { date: last, updatedAt: now })
      continue
    }
    const plan = expense.sourcePlanId !== undefined ? cardPlans.get(expense.sourcePlanId) : undefined
    if (!plan || expense.occurrenceIndex === undefined || expense.statementPeriod === undefined) {
      others.push(expense)
      continue
    }
    // A plan whose purchase now lands in another statement (where
    // closing-day purchases go changed, for a purchase on a closing day)
    // re-places every cuota, closed statements included: one cuota per
    // statement only holds if they all follow the same first statement.
    // (A paid statement in the way rejects the edit — see updateCreditCard.)
    const anchorMoved = statementPeriodFor(before, plan.purchaseDate) !== statementPeriodFor(after, plan.purchaseDate)
    if (!anchorMoved && lastPurchaseDay(before, expense.statementPeriod) < today) {
      // A closed statement keeps its cuotas — but one dated on its closing
      // day, once closing-day purchases go to the next statement, would sit
      // past the last day its statement takes: re-dated, never moved.
      const last = lastPurchaseDay(after, expense.statementPeriod)
      if (expense.date > last) await db.expenses.update(expense.id, { date: last, updatedAt: now })
      continue
    }
    const placement = installmentPlacement(after, plan.purchaseDate, expense.occurrenceIndex)
    if (placement.period === expense.statementPeriod && placement.date === expense.date) continue
    await db.expenses.update(expense.id, { statementPeriod: placement.period, date: placement.date, updatedAt: now })
    moved += 1
  }

  for (const move of reassignedPeriods(others, before, after)) {
    await db.expenses.update(move.id, { statementPeriod: move.statementPeriod, updatedAt: now })
    moved += 1
  }
  return moved
}

export async function createCreditCard(input: CreditCardInput): Promise<CreditCard> {
  assertDays(input)
  assertOpening(input)
  const now = new Date().toISOString()
  return db.transaction('rw', db.creditCards, async () => {
    const last = await db.creditCards.orderBy('order').last()
    const card: CreditCard = {
      id: generateId(),
      name: input.name,
      closingDay: input.closingDay,
      dueDay: input.dueDay,
      ...(input.closingDayToNext && { closingDayToNext: true }),
      ...(input.openingBalances !== undefined &&
        input.openingBalances.length > 0 &&
        input.openingBase !== undefined && { openingBalances: input.openingBalances, openingBase: input.openingBase }),
      isArchived: false,
      order: (last?.order ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    await db.creditCards.add(card)
    return card
  })
}

/**
 * Changing the default days (or where closing-day purchases go) re-places
 * the expenses that were where the OLD settings put them (see `reassignCardExpenses`) — same rule as
 * correcting one period by hand — but never a statement that already
 * closed: those were billed (and maybe paid) with the old days.
 * So first, every closed period with gastos or payments and no corrected dates gets
 * its OLD dates written down as an override, freezing it: the new days
 * only apply from the statement still open today on. Returns how many
 * gastos moved.
 */
export async function updateCreditCard(
  id: string,
  input: Omit<CreditCardInput, 'notes'> & { notes: string | undefined },
): Promise<number> {
  assertDays(input)
  assertOpening(input)
  const tables = [db.creditCards, db.cardStatements, db.expenses, db.installmentPlans, db.statementPayments]
  return db.transaction('rw', tables, async () => {
    const existing = await db.creditCards.get(id)
    invariant(existing, `Tarjeta no encontrada: ${id}`)
    const before = await getCardCalendar(id)
    const openPeriod = statementPeriodFor(before, todayStamp())
    const expenses = await db.expenses.where('cardId').equals(id).toArray()
    const payments = await db.statementPayments.where('cardId').equals(id).toArray()
    // A closed statement with only an opening balance freezes too: its due
    // date decides whether that balance is overdue.
    const closedPeriods = new Set(
      [
        ...expenses.map((e) => e.statementPeriod),
        ...payments.map((p) => p.period),
        ...(existing.openingBalances ?? []).map((b) => b.period),
      ].filter(
        (p): p is string => p !== undefined && p < openPeriod,
      ),
    )
    const now = new Date().toISOString()
    for (const period of closedPeriods) {
      if (before.overrides.some((o) => o.period === period)) continue
      const { closeDate, dueDate } = statementDates(before, period)
      await db.cardStatements.add({ id: generateId(), cardId: id, period, closeDate, dueDate, createdAt: now, updatedAt: now })
    }
    // The calendar before the edit, but with the frozen periods: only open
    // and future statements can move.
    const frozen = await getCardCalendar(id)
    const card: CreditCard = {
      ...existing,
      name: input.name,
      closingDay: input.closingDay,
      dueDay: input.dueDay,
      updatedAt: new Date().toISOString(),
    }
    delete card.notes
    if (input.notes !== undefined) card.notes = input.notes
    delete card.closingDayToNext
    if (input.closingDayToNext) card.closingDayToNext = true
    delete card.openingBalances
    delete card.openingBase
    if (input.openingBalances !== undefined && input.openingBalances.length > 0 && input.openingBase !== undefined) {
      card.openingBalances = input.openingBalances
      card.openingBase = input.openingBase
    }
    await db.creditCards.put(card)
    const periodBefore = new Map(expenses.map((e) => [e.id, e.statementPeriod]))
    const moved = await reassignCardExpenses(id, frozen, await getCardCalendar(id))
    // Where closing-day purchases go also applies to closed statements (the
    // bank already billed them in the next one) — but never in or out of a
    // paid statement (its payment was its total) nor a reconciled one (its
    // charge was the difference with the bank's total). Throwing rolls it
    // all back.
    const settled = new Set([
      ...payments.map((p) => p.period),
      ...expenses.flatMap((e) =>
        e.tags?.includes(STATEMENT_RECONCILE_TAG) && e.statementPeriod !== undefined ? [e.statementPeriod] : [],
      ),
    ])
    // The opening balance is part of a statement's total: same rule.
    const openingKey = (b: { period: string; currency: string; amount: number }) => `${b.period}:${b.currency}:${b.amount}`
    const oldOpening = new Set((existing.openingBalances ?? []).map(openingKey))
    const newOpening = new Set((card.openingBalances ?? []).map(openingKey))
    for (const b of [...(existing.openingBalances ?? []), ...(card.openingBalances ?? [])]) {
      if (oldOpening.has(openingKey(b)) && newOpening.has(openingKey(b))) continue
      invariant(
        !settled.has(b.period),
        'Ese resumen ya está pagado o conciliado — deshacé el pago o borrá el cargo de conciliación para cambiar su saldo inicial',
      )
    }
    const after = await db.expenses.where('cardId').equals(id).toArray()
    for (const expense of after) {
      const from = periodBefore.get(expense.id)
      if (from === expense.statementPeriod) continue
      invariant(
        !(from !== undefined && settled.has(from)) &&
          !(expense.statementPeriod !== undefined && settled.has(expense.statementPeriod)),
        'Ese cambio movería gastos de un resumen pagado o conciliado — deshacé el pago o borrá el cargo de conciliación primero',
      )
    }
    return moved
  })
}

export async function setCreditCardArchived(id: string, isArchived: boolean): Promise<void> {
  await db.creditCards.update(id, { isArchived, updatedAt: new Date().toISOString() })
}

/** Only a card no gasto points at can be deleted; one with history gets
 *  archived instead (same rule as accounts). Its period overrides go with
 *  it. */
export async function deleteCreditCard(id: string): Promise<void> {
  const tables = [db.creditCards, db.cardStatements, db.expenses, db.recurringPlans, db.installmentPlans, db.statementPayments]
  await db.transaction('rw', tables, async () => {
    const used = await db.expenses.where('cardId').equals(id).count()
    invariant(used === 0, 'La tarjeta tiene gastos — archivala en vez de borrarla')
    const payments = await db.statementPayments.where('cardId').equals(id).count()
    invariant(payments === 0, 'La tarjeta tiene resúmenes pagados — archivala en vez de borrarla')
    // A plan pointing at it would fail on every future gasto.
    const plans = await db.recurringPlans.filter((p) => p.template.cardId === id).count()
    const installments = await db.installmentPlans.filter((p) => p.cardId === id).count()
    invariant(plans + installments === 0, 'Hay planes que usan esta tarjeta — cambiales el medio de pago primero')
    await db.cardStatements.where('cardId').equals(id).delete()
    await db.creditCards.delete(id)
  })
}
