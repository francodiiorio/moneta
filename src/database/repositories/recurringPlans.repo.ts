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
