import { db } from '../db'
import type { CreditCard } from '@/domain/entities'
import { reassignedPeriods, statementDates, statementPeriodFor, type CardCalendar } from '@/domain/cards'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { todayStamp } from '@/lib/dates'

export interface CreditCardInput {
  name: string
  closingDay: number
  dueDay: number
  notes?: string
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

/** Moves the card's automatically placed expenses whose statement changed
 *  between two calendars (domain/cards:reassignedPeriods). Must run inside
 *  a transaction covering `db.expenses`. */
export async function reassignCardExpenses(cardId: string, before: CardCalendar, after: CardCalendar): Promise<number> {
  const expenses = await db.expenses.where('cardId').equals(cardId).toArray()
  const moves = reassignedPeriods(expenses, before, after)
  for (const move of moves) {
    await db.expenses.update(move.id, { statementPeriod: move.statementPeriod, updatedAt: new Date().toISOString() })
  }
  return moves.length
}

export async function createCreditCard(input: CreditCardInput): Promise<CreditCard> {
  assertDays(input)
  const now = new Date().toISOString()
  return db.transaction('rw', db.creditCards, async () => {
    const last = await db.creditCards.orderBy('order').last()
    const card: CreditCard = {
      id: generateId(),
      name: input.name,
      closingDay: input.closingDay,
      dueDay: input.dueDay,
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
 * Changing the default days re-places the expenses that were where the
 * OLD days put them (see `reassignCardExpenses`) — same rule as
 * correcting one period by hand — but never a statement that already
 * closed: those were billed (and, from Fase 5, paid) with the old days.
 * So first, every closed period with gastos and no corrected dates gets
 * its OLD dates written down as an override, freezing it: the new days
 * only apply from the statement still open today on. Returns how many
 * gastos moved.
 */
export async function updateCreditCard(
  id: string,
  input: Omit<CreditCardInput, 'notes'> & { notes: string | undefined },
): Promise<number> {
  assertDays(input)
  return db.transaction('rw', [db.creditCards, db.cardStatements, db.expenses], async () => {
    const existing = await db.creditCards.get(id)
    invariant(existing, `Tarjeta no encontrada: ${id}`)
    const before = await getCardCalendar(id)
    const openPeriod = statementPeriodFor(before, todayStamp())
    const expenses = await db.expenses.where('cardId').equals(id).toArray()
    const closedPeriods = new Set(
      expenses.map((e) => e.statementPeriod).filter((p): p is string => p !== undefined && p < openPeriod),
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
    await db.creditCards.put(card)
    return reassignCardExpenses(id, frozen, await getCardCalendar(id))
  })
}

export async function setCreditCardArchived(id: string, isArchived: boolean): Promise<void> {
  await db.creditCards.update(id, { isArchived, updatedAt: new Date().toISOString() })
}

/** Only a card no gasto points at can be deleted; one with history gets
 *  archived instead (same rule as accounts). Its period overrides go with
 *  it. */
export async function deleteCreditCard(id: string): Promise<void> {
  await db.transaction('rw', [db.creditCards, db.cardStatements, db.expenses], async () => {
    const used = await db.expenses.where('cardId').equals(id).count()
    invariant(used === 0, 'La tarjeta tiene gastos — archivala en vez de borrarla')
    await db.cardStatements.where('cardId').equals(id).delete()
    await db.creditCards.delete(id)
  })
}
