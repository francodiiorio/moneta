import {
  accountsRepo,
  categoriesRepo,
  creditCardsRepo,
  expensesRepo,
  installmentPlansRepo,
  recurringPlansRepo,
} from '@/database/repositories'
import type { Account, Category, CreditCard, ExpenseTemplate, InstallmentPlan, RecurringPlan } from '@/domain/entities'
import type { ExpenseInput } from '@/database/repositories/expenses.repo'
import { describeRule, generateOccurrences, nextOccurrenceAfter } from '@/domain/recurrence'
import { cardInstallmentProgress, cuotaInOpenStatement, statementPeriodFor, type CardInstallmentProgress } from '@/domain/cards'
import { money, parseAmount, sub, sumMoney, type Money } from '@/domain/money'
import { todayStamp, type DateStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import { parsePaymentMethod } from './schema'
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
    // The template's payment method: a debit from an account, or a card
    // purchase placed in its statement by date (no statementPeriod given).
    ...(template.accountId !== undefined && { accountId: template.accountId }),
    ...(template.cardId !== undefined && { cardId: template.cardId }),
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
  /** "Débito · Galicia" / "Tarjeta · Visa" — absent when unspecified. */
  paymentLabel?: string
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
  const [plans, categories, planExpenses, { accounts, cards }] = await Promise.all([
    recurringPlansRepo.listRecurringPlans(),
    categoriesRepo.listCategories(),
    expensesRepo.listPlanExpenses(),
    listPaymentOptions(),
  ])
  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const cardName = new Map(cards.map((c) => [c.id, c.name]))
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
      ...(template.accountId !== undefined && { paymentLabel: `Débito · ${accountName.get(template.accountId) ?? 'cuenta'}` }),
      ...(template.cardId !== undefined && { paymentLabel: `Tarjeta · ${cardName.get(template.cardId) ?? 'tarjeta'}` }),
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
    ...parsePaymentMethod(values.paymentMethod),
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
  /** "Tarjeta · Visa" when bought with a card. */
  paymentLabel?: string
  totalAmount: Money
  count: number
  confirmedCount: number
  remaining: Money
  /** Bought with a card: progress the way the bank counts it — by the
   *  statement each cuota is billed in, not by its date. */
  cardProgress?: CardInstallmentProgress
}

export async function listInstallmentPlansWithProgress(today: DateStamp = todayStamp()): Promise<InstallmentPlanListItem[]> {
  const [plans, categories, planExpenses, { cards }] = await Promise.all([
    installmentPlansRepo.listInstallmentPlans(),
    categoriesRepo.listCategories(),
    expensesRepo.listPlanExpenses(),
    listPaymentOptions(),
  ])
  const cardName = new Map(cards.map((c) => [c.id, c.name]))
  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))
  // The statement open today, per card a plan is paid with.
  const openPeriodByCard = new Map<string, string>()
  for (const cardId of new Set(plans.flatMap((p) => (p.cardId !== undefined ? [p.cardId] : [])))) {
    openPeriodByCard.set(cardId, statementPeriodFor(await creditCardsRepo.getCardCalendar(cardId), today))
  }

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
    // Cuotas before startIndex were paid before Moneta: they count as paid.
    const startIndex = plan.startIndex ?? 0
    const isPaid = (index: number) => index < startIndex || confirmedIndexes.has(index)
    const confirmedAmount = sumMoney(
      plan.currency,
      plan.scheduleCache.filter((_, index) => isPaid(index)).map((amount) => money(amount, plan.currency)),
    )
    const totalAmount = money(plan.totalAmount, plan.currency)
    const category = categoryById.get(plan.categoryId)
    const openPeriod = plan.cardId !== undefined ? openPeriodByCard.get(plan.cardId) : undefined
    // Only cuotas still in this plan's card and currency (an edited one
    // could have left either; a hand-made backup too) — and none at all
    // falls back to the by-date count instead of reading as "Terminada".
    const cuotas = planExpenses.flatMap((e) =>
      e.sourcePlanId === plan.id &&
      e.occurrenceIndex !== undefined &&
      e.statementPeriod !== undefined &&
      e.cardId === plan.cardId &&
      e.currency === plan.currency
        ? [{ index: e.occurrenceIndex, period: e.statementPeriod, amount: money(e.amount, e.currency) }]
        : [],
    )
    const tracked =
      openPeriod === undefined || cuotas.length === 0 ? undefined : cardInstallmentProgress(cuotas, openPeriod, plan.currency)
    const cardProgress = tracked && { ...tracked, billedCount: tracked.billedCount + startIndex }
    return {
      id: plan.id,
      plan,
      description: plan.description,
      categoryLabel: category?.name ?? 'Categoría eliminada',
      ...(plan.cardId !== undefined && { paymentLabel: `Tarjeta · ${cardName.get(plan.cardId) ?? 'tarjeta'}` }),
      ...(category?.color !== undefined && { categoryColor: category.color }),
      ...(category?.icon !== undefined && { categoryIcon: category.icon }),
      totalAmount,
      count: plan.count,
      confirmedCount: plan.scheduleCache.filter((_, index) => isPaid(index)).length,
      remaining: sub(totalAmount, confirmedAmount),
      ...(cardProgress !== undefined && { cardProgress }),
    }
  })
}

export async function createInstallmentPlanFromForm(values: InstallmentPlanFormValues): Promise<InstallmentPlan> {
  const totalAmount = parseAmount(values.totalAmount, values.currency)
  // Already under way: Moneta tracks from cuota N on (index N − 1); the
  // ones before were paid before Moneta (or sit in the card's opening
  // balance) and are never generated.
  const n = values.alreadyPaying ? Number(values.currentCuota) : 1
  let startIndex = n - 1
  if (values.alreadyPaying && values.cardId) {
    // The bank's number must match the purchase date: every cuota is placed
    // from that date, so a mismatch would shift them all a statement.
    const expected = await cuotaInOpenStatementFor(values.cardId, values.purchaseDate)
    invariant(expected >= 1, 'La compra todavía no entró en ningún resumen: no hace falta "Ya la venía pagando"')
    invariant(
      expected === n,
      `Con esa fecha de compra, la cuota del resumen en curso es la ${expected}, no la ${n}. Corregí la fecha o el día de cierre de la tarjeta`,
    )
    // Already inside the card's opening balance for today's statement: from the next one.
    if (values.currentCuotaInOpening) startIndex = n
  }
  invariant(startIndex < Number(values.count), 'Ya no quedan cuotas por cargar')
  // With a card, cuotas follow the purchase (one per statement). Without
  // one, the form's date is when the first tracked cuota is due.
  const firstDueDate = values.cardId ? values.purchaseDate : values.firstDueDate

  return installmentPlansRepo.createInstallmentPlan({
    description: values.description,
    categoryId: values.categoryId,
    currency: values.currency,
    totalAmount: totalAmount.amount,
    count: Number(values.count),
    firstDueDate,
    purchaseDate: values.purchaseDate,
    ...(values.cardId && { cardId: values.cardId }),
    ...(startIndex > 0 && { startIndex }),
  })
}

/** With a card, the cuota a purchase on `purchaseDate` has in the
 *  statement open today — to check it against the bank's number. */
export async function openStatementHasOpening(cardId: string, currency: string, today: DateStamp = todayStamp()): Promise<boolean> {
  const calendar = await creditCardsRepo.getCardCalendar(cardId)
  const open = statementPeriodFor(calendar, today)
  return (calendar.card.openingBalances ?? []).some((b) => b.period === open && b.currency === currency)
}

export async function cuotaInOpenStatementFor(cardId: string, purchaseDate: DateStamp, today: DateStamp = todayStamp()): Promise<number> {
  return cuotaInOpenStatement(await creditCardsRepo.getCardCalendar(cardId), purchaseDate, today)
}

/** Accounts and cards for the plans' payment method pickers — archived
 *  ones included, so an existing plan keeps showing its own. */
export async function listPaymentOptions(): Promise<{ accounts: Account[]; cards: CreditCard[] }> {
  const [accounts, cards] = await Promise.all([accountsRepo.listAccounts(), creditCardsRepo.listCreditCards()])
  return { accounts, cards }
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

export const listExpenseCategories = () => categoriesRepo.listActiveCategories('expense')
