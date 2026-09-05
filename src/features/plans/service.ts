import { categoriesRepo, expensesRepo, installmentPlansRepo, recurringPlansRepo } from '@/database/repositories'
import type { ExpenseTemplate, Category, InstallmentPlan, RecurringPlan } from '@/domain/entities'
import type { ExpenseInput } from '@/database/repositories/expenses.repo'
import { describeRule, generateOccurrences, nextOccurrenceAfter } from '@/domain/recurrence'
import { money, parseAmount, sub, sumMoney, type Money } from '@/domain/money'
import { todayStamp, type DateStamp } from '@/lib/dates'
import type { InstallmentPlanEditFormValues, InstallmentPlanFormValues, RecurringPlanFormValues } from './schema'

/** Thrown by createRecurringPlanFromForm/updateRecurringPlanFromForm/
 *  setRecurringPlanPaused when the plan write itself already succeeded
 *  but the immediate materializeDue() catch-up failed for THIS plan.
 *  Distinct from a plain InvariantError (used all over this file for
 *  "the write itself was rejected") so a caller can tell "nothing
 *  happened, fix the form and resubmit" apart from "the plan is real,
 *  don't resubmit the same create form — that would create a genuine
 *  duplicate plan" (see RecurringPlanFormDialog.tsx). */
export class MaterializationFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterializationFailedError'
  }
}

function buildTemplateEntry(
  template: ExpenseTemplate,
  date: DateStamp,
  sourcePlanId: string,
  occurrenceIndex: number,
): ExpenseInput {
  return {
    date,
    description: template.description,
    categoryId: template.categoryId,
    amount: template.amount,
    currency: template.currency,
    status: 'confirmed',
    sourcePlanId,
    occurrenceIndex,
  }
}

export interface MaterializationSummary {
  recurringCreated: number
  installmentsConfirmed: number
  /** ids of recurring plans that threw while materializing (e.g. a plan
   *  left in an invalid state by a hand-edited backup import) — these are
   *  skipped, not fatal to the rest, see the per-plan try/catch below. */
  failedPlanIds: string[]
}

/**
 * Catches up everything due as of `today`: creates confirmed expenses for
 * every recurring occurrence since each plan's last materialized date,
 * and promotes any `projected` cuota whose date has arrived to
 * `confirmed`. Safe to call on every app load — a plan's watermark
 * (`lastMaterializedDate`) only advances together with its writes, in the
 * same transaction, so running this twice **in sequence** creates nothing
 * new the second time. That guarantee does NOT hold for two calls running
 * concurrently — see `materializeDue` below, the only way this should
 * ever be invoked, which serializes calls specifically to preserve it.
 *
 * Each plan is materialized independently: a single plan that fails
 * (in practice, only reachable via a hand-edited backup import) is
 * skipped rather than aborting every other plan and the cuota sweep.
 * Before this guard, one broken plan would silently stop ALL recurring
 * materialization and installment confirmation, forever, on every app
 * load — see docs/DECISIONS.md if that's documented, otherwise treat
 * this comment as the record of why the try/catch is here.
 */
async function materializeDueUnsafe(today: DateStamp = todayStamp()): Promise<MaterializationSummary> {
  const plans = await recurringPlansRepo.listRecurringPlans()
  let recurringCreated = 0
  const failedPlanIds: string[] = []

  for (const plan of plans) {
    if (plan.isPaused) continue
    try {
      const since = plan.lastMaterializedDate ?? ''
      const due = generateOccurrences(plan.rule, today)
        .map((date, index) => ({ date, index }))
        .filter((occurrence) => occurrence.date > since)
      if (due.length === 0) continue

      const entries = due.map((occurrence) =>
        buildTemplateEntry(plan.template, occurrence.date, plan.id, occurrence.index),
      )
      const throughDate = due[due.length - 1]!.date
      await recurringPlansRepo.materializePlan(plan.id, entries, throughDate)
      recurringCreated += entries.length
    } catch (error) {
      failedPlanIds.push(plan.id)
      console.error(`No se pudo poner al día el recurrente ${plan.id}`, error)
    }
  }

  const installmentsConfirmed = await expensesRepo.confirmDueProjected(today)

  return { recurringCreated, installmentsConfirmed, failedPlanIds }
}

/** Chains every call onto a single queue so no two runs ever overlap.
 *  Without this, App.tsx's boot-time sweep (still in flight) and, say, a
 *  user creating a plan a moment later could each read the same plan's
 *  `lastMaterializedDate` before either has written anything, both
 *  compute the same occurrence as due, and both write it — a duplicate
 *  expense, i.e. real money double-counted. Chaining onto the previous
 *  call's promise guarantees a queued call's read only ever happens
 *  after the previous call's writes have fully committed, so it always
 *  sees the true current watermark. `.catch(() => undefined)` on the
 *  queue itself (not on what callers receive back) keeps one rejected
 *  run from wedging every call queued after it.
 *
 *  This now serializes every call, not just genuinely concurrent ones —
 *  e.g. toggling a plan's pause state waits behind a same-tick boot
 *  sweep. Acceptable here: `materializeDueUnsafe` is O(number of plans),
 *  and this is a local, single-user app with a handful of recurring
 *  plans/cuotas, not hundreds. Revisit if that assumption ever changes
 *  (e.g. a bulk-import of many plans at once). */
let materializeQueue: Promise<unknown> = Promise.resolve()

export function materializeDue(today: DateStamp = todayStamp()): Promise<MaterializationSummary> {
  const run = materializeQueue.then(() => materializeDueUnsafe(today))
  materializeQueue = run.catch(() => undefined)
  return run
}

export interface RecurringPlanListItem {
  id: string
  /** The raw entity, for the edit dialog's default values — see
   *  features/networth's InvestmentHoldingWithDetails for the same
   *  "display item embeds the entity" pattern. */
  plan: RecurringPlan
  description: string
  categoryLabel?: string
  categoryColor?: string
  categoryIcon?: string
  amount: Money
  ruleDescription: string
  isPaused: boolean
  nextOccurrence?: DateStamp
  /** How many expenses this plan has already generated — shown in the
   *  delete confirmation so "borrar también el historial" isn't a blind
   *  choice. */
  generatedCount: number
}

export async function listRecurringPlansWithNext(): Promise<RecurringPlanListItem[]> {
  const [plans, categories, planExpenses] = await Promise.all([
    recurringPlansRepo.listRecurringPlans(),
    categoriesRepo.listCategories(),
    expensesRepo.listPlanExpenses(),
  ])
  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))
  const today = todayStamp()

  const generatedCountByPlanId = new Map<string, number>()
  for (const expense of planExpenses) {
    if (!expense.sourcePlanId) continue
    generatedCountByPlanId.set(expense.sourcePlanId, (generatedCountByPlanId.get(expense.sourcePlanId) ?? 0) + 1)
  }

  return plans.map((plan) => {
    const { template } = plan
    const nextOccurrence = plan.isPaused ? undefined : nextOccurrenceAfter(plan.rule, today)
    const category = categoryById.get(template.categoryId)
    return {
      id: plan.id,
      plan,
      description: template.description,
      categoryLabel: category?.name ?? '—',
      ...(category?.color !== undefined && { categoryColor: category.color }),
      ...(category?.icon !== undefined && { categoryIcon: category.icon }),
      amount: money(template.amount, template.currency),
      ruleDescription: describeRule(plan.rule),
      isPaused: plan.isPaused,
      generatedCount: generatedCountByPlanId.get(plan.id) ?? 0,
      ...(nextOccurrence !== undefined && { nextOccurrence }),
    }
  })
}

/** Shared by create and update — building a template+rule from form values
 *  never depends on whether a plan already exists. */
function buildRecurringPlanWrite(values: RecurringPlanFormValues): { template: ExpenseTemplate; rule: RecurringPlan['rule'] } {
  const amount = parseAmount(values.amount, values.currency)

  const template: ExpenseTemplate = {
    description: values.description,
    categoryId: values.categoryId,
    amount: amount.amount,
    currency: values.currency,
  }

  const interval = Number(values.interval)
  const dayOfMonth = values.dayOfMonth ? Number(values.dayOfMonth) : undefined
  const maxOccurrences = values.maxOccurrences ? Number(values.maxOccurrences) : undefined

  return {
    template,
    rule: {
      freq: values.freq,
      interval,
      startDate: values.startDate,
      ...(dayOfMonth !== undefined && { dayOfMonth }),
      ...(values.endDate !== undefined && values.endDate !== '' && { endDate: values.endDate }),
      ...(maxOccurrences !== undefined && { maxOccurrences }),
    },
  }
}

/** Calls materializeDue() right after a plan write and turns ANY failure
 *  that could affect `planId` into a MaterializationFailedError — both
 *  the "this plan's occurrence specifically failed" case
 *  (`failedPlanIds`, which materializeDue() populates instead of
 *  throwing, so one broken plan can't block every other plan's catch-up)
 *  and the "materializeDue() rejected outright" case (e.g.
 *  confirmDueProjected or listRecurringPlans throwing — see App.tsx's own
 *  "materializeDue falló por completo" handling for the same
 *  possibility). Both cases mean the same thing to a caller: the plan
 *  write already succeeded, only the immediate catch-up didn't. */
async function materializeAfterWrite(planId: string, failureMessage: string): Promise<void> {
  let failedPlanIds: string[]
  try {
    ;({ failedPlanIds } = await materializeDue())
  } catch {
    throw new MaterializationFailedError(failureMessage)
  }
  if (failedPlanIds.includes(planId)) {
    throw new MaterializationFailedError(failureMessage)
  }
}

/** Calls materializeAfterWrite() right after the write so a plan whose
 *  first (or next) occurrence is due today shows up immediately —
 *  otherwise nothing re-runs materialization until the next full app
 *  load (App.tsx's mount-time call), which could be minutes, hours, or a
 *  full reload away in the same session. Regression: creating a
 *  recurring plan with startDate = today used to silently wait for a
 *  reload before its first payment appeared in Movimientos. */
export async function createRecurringPlanFromForm(values: RecurringPlanFormValues): Promise<RecurringPlan> {
  const write = buildRecurringPlanWrite(values)
  const plan = await recurringPlansRepo.createRecurringPlan(write)
  await materializeAfterWrite(plan.id, 'El recurrente se creó, pero no se pudo generar su primer movimiento')
  return plan
}

/** Only affects materialization from now on — see
 *  recurringPlansRepo.updateRecurringPlan. Also catches up immediately,
 *  same reasoning as createRecurringPlanFromForm — e.g. moving startDate
 *  earlier can make an occurrence newly due as of today. */
export async function updateRecurringPlanFromForm(id: string, values: RecurringPlanFormValues): Promise<RecurringPlan> {
  const write = buildRecurringPlanWrite(values)
  const plan = await recurringPlansRepo.updateRecurringPlan(id, write)
  await materializeAfterWrite(id, 'El recurrente se actualizó, pero no se pudo poner al día')
  return plan
}

/** Also catches up immediately on un-pause — a plan accumulates nothing
 *  while paused (materializeDue skips it entirely), so occurrences that
 *  piled up should appear as soon as the user un-pauses, not on the next
 *  reload. A no-op call when pausing (materializeDue skips a paused plan
 *  the same way), which is fine — the point is the un-pause case. */
export async function setRecurringPlanPaused(id: string, isPaused: boolean): Promise<void> {
  await recurringPlansRepo.setRecurringPlanPaused(id, isPaused)
  await materializeAfterWrite(id, 'No se pudo poner al día el recurrente')
}

export async function removeRecurringPlan(
  id: string,
  options?: { deleteGeneratedExpenses?: boolean },
): Promise<void> {
  await recurringPlansRepo.deleteRecurringPlan(id, options)
}

export interface InstallmentPlanListItem {
  id: string
  /** The raw entity, for the edit dialog's default values. */
  plan: InstallmentPlan
  description: string
  categoryLabel: string
  categoryColor?: string
  categoryIcon?: string
  totalAmount: Money
  count: number
  confirmedCount: number
  remaining: Money
}

export async function listInstallmentPlansWithProgress(): Promise<InstallmentPlanListItem[]> {
  const [plans, categories, planExpenses] = await Promise.all([
    installmentPlansRepo.listInstallmentPlans(),
    categoriesRepo.listCategories(),
    expensesRepo.listPlanExpenses(),
  ])
  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))

  // Indexed by occurrenceIndex, not just counted, so that deleting or
  // editing a single cuota (allowed — see docs/DECISIONS.md) doesn't
  // throw off the count/amount of the others: a gap in the middle stays
  // a gap instead of silently shifting later cuotas down by one.
  const confirmedIndexesByPlan = new Map<string, Set<number>>()
  for (const expense of planExpenses) {
    if (expense.status !== 'confirmed' || !expense.sourcePlanId || expense.occurrenceIndex === undefined) {
      continue
    }
    const indexes = confirmedIndexesByPlan.get(expense.sourcePlanId) ?? new Set<number>()
    indexes.add(expense.occurrenceIndex)
    confirmedIndexesByPlan.set(expense.sourcePlanId, indexes)
  }

  return plans.map((plan) => {
    const confirmedIndexes = confirmedIndexesByPlan.get(plan.id) ?? new Set<number>()
    const confirmedAmount = sumMoney(
      plan.currency,
      plan.scheduleCache
        .filter((_, index) => confirmedIndexes.has(index))
        .map((amount) => money(amount, plan.currency)),
    )
    const totalAmount = money(plan.totalAmount, plan.currency)
    const category = categoryById.get(plan.categoryId)
    return {
      id: plan.id,
      plan,
      description: plan.description,
      categoryLabel: category?.name ?? 'Categoría eliminada',
      ...(category?.color !== undefined && { categoryColor: category.color }),
      ...(category?.icon !== undefined && { categoryIcon: category.icon }),
      totalAmount,
      count: plan.count,
      confirmedCount: confirmedIndexes.size,
      remaining: sub(totalAmount, confirmedAmount),
    }
  })
}

export async function createInstallmentPlanFromForm(values: InstallmentPlanFormValues): Promise<InstallmentPlan> {
  const totalAmount = parseAmount(values.totalAmount, values.currency)

  return installmentPlansRepo.createInstallmentPlan({
    description: values.description,
    categoryId: values.categoryId,
    currency: values.currency,
    totalAmount: totalAmount.amount,
    count: Number(values.count),
    firstDueDate: values.firstDueDate,
    purchaseDate: values.purchaseDate,
  })
}

/** Narrower than createInstallmentPlanFromForm — see
 *  installmentPlansRepo.updateInstallmentPlan for why totalAmount/count/
 *  dates/currency aren't part of this. */
export async function updateInstallmentPlanFromForm(
  id: string,
  values: InstallmentPlanEditFormValues,
): Promise<InstallmentPlan> {
  return installmentPlansRepo.updateInstallmentPlan(id, {
    description: values.description,
    categoryId: values.categoryId,
  })
}

export async function removeInstallmentPlan(id: string): Promise<void> {
  await installmentPlansRepo.deleteInstallmentPlan(id)
}

export const listExpenseCategories = categoriesRepo.listActiveCategories
