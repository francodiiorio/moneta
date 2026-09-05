import { db } from '../db'
import type { ExpenseTemplate, RecurrenceRule, RecurringPlan } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import type { DateStamp } from '@/lib/dates'
import { deleteAllBySourcePlanId, saveExpense, type ExpenseInput } from './expenses.repo'

export interface CreateRecurringPlanInput {
  template: ExpenseTemplate
  rule: RecurrenceRule
}

export async function listRecurringPlans(): Promise<RecurringPlan[]> {
  return db.recurringPlans.toArray()
}

export async function createRecurringPlan(input: CreateRecurringPlanInput): Promise<RecurringPlan> {
  invariant(input.template.amount > 0, `El monto debe ser mayor a cero, recibido: ${input.template.amount}`)

  const now = new Date().toISOString()
  const plan: RecurringPlan = {
    id: generateId(),
    template: input.template,
    rule: input.rule,
    isPaused: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.recurringPlans.add(plan)
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

  const updated = await db.recurringPlans.update(id, {
    template: input.template,
    rule: input.rule,
    updatedAt: new Date().toISOString(),
  })
  invariant(updated === 1, `No se encontró el recurrente: ${id}`)

  const plan = await db.recurringPlans.get(id)
  invariant(plan, `No se encontró el recurrente: ${id}`)
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
  await db.transaction('rw', db.recurringPlans, db.expenses, async () => {
    if (options?.deleteGeneratedExpenses) {
      await deleteAllBySourcePlanId(id)
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
  await db.transaction('rw', db.recurringPlans, db.expenses, async () => {
    for (const entry of entries) {
      await saveExpense(entry)
    }
    await db.recurringPlans.update(planId, {
      lastMaterializedDate: throughDate,
      updatedAt: new Date().toISOString(),
    })
  })
}
