import { cardCalendarOf, cardCuotaRedates } from '@/domain/cards'
import { todayStamp, type DateStamp } from '@/lib/dates'
import type { BackupDataV10 } from '../schemas/v10'
import type { BackupDataV11 } from '../schemas/v11'

/** Etapa 9, Fase 3: a card plan's cuotas after the first are dated on
 *  their statement's last purchase day (and spent once it comes) — a v10
 *  file still has them on the purchase day shifted N months. Same shape;
 *  only those dates and statuses change. */
export function migrateV10ToV11(data: BackupDataV10, today: DateStamp = todayStamp()): BackupDataV11 {
  const calendars = new Map(data.creditCards.map((card) => [card.id, cardCalendarOf(card, data.cardStatements, card.id)]))
  const cardPlanIds = new Set(data.installmentPlans.filter((p) => p.cardId !== undefined).map((p) => p.id))
  const existingPlanIds = new Set([...data.installmentPlans, ...data.recurringPlans].map((p) => p.id))
  const changes = new Map(cardCuotaRedates(data.expenses, cardPlanIds, calendars, today, existingPlanIds).map((c) => [c.id, c]))
  return {
    ...data,
    expenses: data.expenses.map((expense) => {
      const change = changes.get(expense.id)
      return change ? { ...expense, date: change.date, status: change.status } : expense
    }),
  }
}
