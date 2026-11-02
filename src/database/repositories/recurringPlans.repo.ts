import { db } from '../db'
import type { ExpenseTemplate, RecurrenceRule, RecurringPlan } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import { firstPendingOccurrence } from '@/domain/recurrence'
import type { DateStamp } from '@/lib/dates'
import { deleteAllBySourcePlanId, saveExpense, type ExpenseInput } from './expenses.repo'
import { saveIncome, type IncomeInput } from './incomes.repo'
import { assertAccountAccepts } from './accounts.repo'
import { getCardCalendar } from './creditCards.repo'

export interface CreateRecurringPlanInput {
  /** Absent: a gasto. See RecurringPlan.kind. */
  kind?: RecurringPlan['kind']
  template: ExpenseTemplate
  rule: RecurrenceRule
}

/** A plan's payment method has to accept every gasto it will still
 *  generate — checked at the first of them (`firstPendingOccurrence`):
 *  the debit account must share the template's currency and be open by
 *  then, and the card must exist. Dates already generated are history, so
 *  adding a debit to an old plan only needs the account open from now on.
 *  Otherwise every app open would fail to materialize it. */
async function assertPaymentMethod(input: CreateRecurringPlanInput, lastMaterializedDate?: DateStamp): Promise<void> {
  const { accountId, cardId, currency } = input.template
  if (input.kind === 'income') {
    invariant(accountId !== undefined, 'Un ingreso fijo necesita la cuenta a la que entra')
    invariant(cardId === undefined, 'Un ingreso fijo no puede entrar a una tarjeta')
    const category = await db.categories.get(input.template.categoryId)
    invariant(category?.kind === 'income', 'Un ingreso fijo necesita una categoría de ingreso')
  }
  if (accountId !== undefined) {
    const firstPending = firstPendingOccurrence(input.rule, lastMaterializedDate)
    if (firstPending !== undefined) {
      await assertAccountAccepts(accountId, { date: firstPending, currency })
    } else {
      const account = await db.accounts.get(accountId)
      invariant(account, `Cuenta no encontrada: ${accountId}`)
      invariant(account.currency === currency, `La cuenta "${account.name}" es en ${account.currency}, el gasto fijo es en ${currency}`)
    }
  }
  if (cardId !== undefined) await getCardCalendar(cardId)
}

export async function listRecurringPlans(): Promise<RecurringPlan[]> {
  return db.recurringPlans.toArray()
}

export async function createRecurringPlan(input: CreateRecurringPlanInput): Promise<RecurringPlan> {
  invariant(input.template.amount > 0, `El monto debe ser mayor a cero, recibido: ${input.template.amount}`)

  const now = new Date().toISOString()
  const plan: RecurringPlan = {
    id: generateId(),
    ...(input.kind === 'income' && { kind: 'income' as const }),
    template: input.template,
    rule: input.rule,
    isPaused: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', [db.recurringPlans, db.accounts, db.creditCards, db.cardStatements, db.categories], async () => {
    await assertPaymentMethod(input)
    await db.recurringPlans.add(plan)
  })
  return plan
}

/**
 * Overwrites the plan's template/rule going forward — never touches any
 * expense already materialized from it (see docs/DECISIONS.md
 * "Recurrentes y cuotas como planes + instancias materializadas": a rule
 * change never recalculates past occurrences). `materializeDue` only ever
 * reads the plan's *current* template/rule for dates after
 * `lastMaterializedDate`, so this takes effect on the very next run.
 *
 * A patch via `Table.update()`, not `get` + spread + `put`: the latter
 * would round-trip every field on `existing`, including
 * `lastMaterializedDate` — if a `materializePlan()` write for this same
 * plan (another tab, the app's own startup sweep) lands between that `get`
 * and the `put`, its advanced watermark would get overwritten back to the
 * stale value this function read, and the next materialization would
 * re-create — and re-confirm — expenses that already happened.
 */
export async function updateRecurringPlan(id: string, input: CreateRecurringPlanInput): Promise<RecurringPlan> {
  invariant(input.template.amount > 0, `El monto debe ser mayor a cero, recibido: ${input.template.amount}`)

  const updated = await db.transaction('rw', [db.recurringPlans, db.accounts, db.creditCards, db.cardStatements, db.categories], async () => {
    const existing = await db.recurringPlans.get(id)
    invariant(existing, `No se encontró el gasto fijo: ${id}`)
    // What a plan generates never changes: its history is one kind.
    invariant((existing.kind ?? 'expense') === (input.kind ?? 'expense'), 'Un gasto fijo no se puede convertir en ingreso fijo, ni al revés')
    await assertPaymentMethod(input, existing.lastMaterializedDate)
    return db.recurringPlans.update(id, {
      template: input.template,
      rule: input.rule,
      updatedAt: new Date().toISOString(),
    })
  })
  invariant(updated === 1, `No se encontró el gasto fijo: ${id}`)

  const plan = await db.recurringPlans.get(id)
  invariant(plan, `No se encontró el gasto fijo: ${id}`)
  return plan
}

export async function setRecurringPlanPaused(id: string, isPaused: boolean): Promise<void> {
  await db.recurringPlans.update(id, { isPaused, updatedAt: new Date().toISOString() })
}

/**
 * By default, deleting a plan only stops future materialization — every
 * already-materialized expense is real money that already moved and stays
 * untouched (see docs/DECISIONS.md). Pass `deleteGeneratedExpenses: true`
 * for the explicit, destructive opt-in to also erase everything this plan
 * ever generated — e.g. undoing a recurring plan created by mistake.
 *
 * Narrow, pre-existing class of race, now with an irreversible consequence:
 * a `materializePlan()` call for this same plan in another tab could commit
 * a brand new expense after `deleteAllBySourcePlanId`'s scan already ran,
 * leaving it with a `sourcePlanId` pointing at a plan that no longer
 * exists — the same orphaned-reference shape the default (non-deleting)
 * path already produces for every plan deletion, not a new integrity risk.
 */
export async function deleteRecurringPlan(
  id: string,
  options?: { deleteGeneratedExpenses?: boolean },
): Promise<void> {
  await db.transaction('rw', db.recurringPlans, db.expenses, db.incomes, async () => {
    if (options?.deleteGeneratedExpenses) {
      await deleteAllBySourcePlanId(id)
      // An income plan's ingresos (no index on it: a small table, scanned).
      await db.incomes.filter((income) => income.sourcePlanId === id).delete()
    }
    await db.recurringPlans.delete(id)
  })
}

/**
 * Persists every input in `entries` (already-built expense drafts, one per
 * newly-due occurrence) and advances `lastMaterializedDate` to
 * `throughDate`, atomically — advancing the watermark without the writes
 * succeeding (or vice versa) is exactly what would make a re-run
 * duplicate or skip an occurrence.
 */
export async function materializePlan(
  planId: string,
  entries: readonly ExpenseInput[],
  throughDate: DateStamp,
): Promise<void> {
  if (entries.length === 0) return
  // Accounts and card tables too: a template's payment method makes each
  // generated gasto a debit or a card purchase (saveExpense nests here).
  const tables = [db.recurringPlans, db.expenses, db.categories, db.accounts, db.creditCards, db.cardStatements]
  await db.transaction('rw', tables, async () => {
    for (const entry of entries) {
      await saveExpense(entry)
    }
    await db.recurringPlans.update(planId, {
      lastMaterializedDate: throughDate,
      updatedAt: new Date().toISOString(),
    })
  })
}

/** materializePlan for an income plan: its ingresos and the watermark,
 *  atomically. */
export async function materializeIncomePlan(
  planId: string,
  entries: readonly IncomeInput[],
  throughDate: DateStamp,
): Promise<void> {
  if (entries.length === 0) return
  await db.transaction('rw', [db.recurringPlans, db.incomes, db.categories, db.accounts], async () => {
    for (const entry of entries) {
      await saveIncome(entry)
    }
    await db.recurringPlans.update(planId, {
      lastMaterializedDate: throughDate,
      updatedAt: new Date().toISOString(),
    })
  })
}
