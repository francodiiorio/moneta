import { db } from '../db'
import type { RecurrenceRule, RecurringPlan, TransactionTemplate } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'
import type { LedgerEntryDraft } from '@/domain/ledger'
import type { DateStamp } from '@/lib/dates'
import { writeLedgerEntry } from './transactions.repo'

export interface CreateRecurringPlanInput {
  template: TransactionTemplate
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
 * transaction already materialized from it (see docs/DECISIONS.md
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
 * re-create — and re-confirm — transactions that already happened.
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

export async function deleteRecurringPlan(id: string): Promise<void> {
  await db.recurringPlans.delete(id)
}

/**
 * Persists every entry in `entries` (already-built ledger drafts, one per
 * newly-due occurrence) and advances `lastMaterializedDate` to
 * `throughDate`, atomically — advancing the watermark without the writes
 * succeeding (or vice versa) is exactly what would make a re-run
 * duplicate or skip an occurrence.
 */
export async function materializePlan(
  planId: string,
  entries: readonly LedgerEntryDraft[],
  throughDate: DateStamp,
): Promise<void> {
  if (entries.length === 0) return
  await db.transaction('rw', db.recurringPlans, db.transactions, db.postings, db.accounts, async () => {
    for (const entry of entries) {
      await writeLedgerEntry(entry)
    }
    await db.recurringPlans.update(planId, {
      lastMaterializedDate: throughDate,
      updatedAt: new Date().toISOString(),
    })
  })
}
