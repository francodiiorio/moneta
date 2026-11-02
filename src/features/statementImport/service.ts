import { categoriesRepo, creditCardsRepo, expensesRepo, installmentPlansRepo, statementImportRepo } from '@/database/repositories'
import { installmentPlacement, lastPurchaseDay, openingBalanceOf, reassignedPeriods, type CardCalendar } from '@/domain/cards'
import type { Category, CreditCard, Expense } from '@/domain/entities'
import { add, money, sumMoney, times } from '@/domain/money'
import { daysBetween, formatMonthLabel, formatShortDate, monthOf, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import { takeCandidate, type DuplicateCandidate } from '@/features/csvImport/matching'
import { unreadAmount, type ParsedStatement, type ParsedStatementItem, type StatementCurrency } from './bbva'
import { guessCategoryName, normalizeMerchant } from './merchants'

/** Where the statement's taxes and charges go — created on import if missing. */
export const CHARGES_CATEGORY_NAME = 'Impuestos y comisiones'

const CURRENCIES: readonly StatementCurrency[] = ['ARS', 'USD']

/** How far apart a purchase date in Moneta and the bank's can be and
 *  still be the same installment purchase (loaded by hand, a day off). */
const PLAN_MATCH_WINDOW_DAYS = 7

export type ImportRowKind = 'purchase' | 'installment' | 'charge'

/**
 * - `new`: not in Moneta yet.
 * - `loaded`: already in Moneta — the same gasto (amount and currency,
 *   within a few days or in the same statement; each counts once) or the
 *   plan of that purchase.
 * - `cancelled`: a credit and the charge of the same merchant it reverses
 *   (a refund, a tax reversed) — neither goes in by default.
 * - `skipped`: never importable — the previous statement's payment, a
 *   credit with nothing to cancel (Moneta has no refunds), a zero amount.
 */
export type ImportRowStatus = 'new' | 'loaded' | 'cancelled' | 'skipped'

export interface ImportRow {
  key: string
  kind: ImportRowKind
  status: ImportRowStatus
  note?: string
  /** Ticked when the preview opens: new rows, except a possible duplicate. */
  suggested: boolean
  /** A credit (negative on the statement): never imported. */
  credit: boolean
  /** As the bank dated it. */
  date: DateStamp
  /** The gasto's date in Moneta: the bank's, but never past the last day
   *  the statement takes (a charge dated on the close of a card whose
   *  closing-day purchases go to the next statement). */
  bookDate: DateStamp
  /** The statement it lands in once imported — another one for a cuota
   *  the card's days place elsewhere. */
  period: MonthStamp
  /** The merchant as a person would write it. */
  description: string
  /** As the bank printed it. */
  original: string
  currency: StatementCurrency
  /** Positive, minor units (a credit's absolute value). */
  amount: number
  installment?: { number: number; count: number }
  /** Suggested — the user can change it. '' for a charge when the
   *  charges category doesn't exist yet (the import creates it). */
  categoryId: string
}

export interface ImportCheck {
  currency: StatementCurrency
  /** What the bank billed in this statement, from its printed balances:
   *  balance − previous balance − the previous statement's payment. */
  bank: number
  /** What Moneta has in the statement after importing the ticked rows. */
  moneta: number
}

export interface StatementImportPreview {
  cardId: string
  /** The statement it fills: the month it closes in. */
  period: MonthStamp
  product?: string
  account?: string
  closeDate: DateStamp
  dueDate: DateStamp
  nextCloseDate?: DateStamp
  nextDueDate?: DateStamp
  rows: ImportRow[]
  /** What Moneta has in the statement before importing (gastos — placed
   *  with the statement's real dates — and the card's opening balance). */
  existing: Record<StatementCurrency, number>
  bank: Record<StatementCurrency, number>
  /** What the read lines don't account for, per currency: not zero means
   *  some line of the PDF wasn't read. */
  unread: Record<StatementCurrency, number>
  /** The statement or the next one is paid in Moneta: their dates stay. */
  datesLocked: boolean
}

function isPreviousPayment(item: ParsedStatementItem): boolean {
  return item.section === 'payments' && /^SU PAGO/i.test(item.description)
}

/** "Rappi (cuota 2/3)" and "Rappi" are the same merchant. */
function merchantKey(description: string): string {
  return description.replace(/\s*\(cuota \d+\/\d+\)$/i, '').replace(/\s*\(adelanto en efectivo\)$/i, '').trim().toLowerCase()
}

/** The category each merchant got most recently — so a correction the
 *  user made once applies to every later import. */
function lastCategoryByMerchant(expenses: readonly Expense[]): Map<string, string> {
  const byMerchant = new Map<string, Expense>()
  for (const expense of expenses) {
    const key = merchantKey(expense.description)
    const current = byMerchant.get(key)
    if (!current || expense.date > current.date || (expense.date === current.date && expense.createdAt > current.createdAt)) {
      byMerchant.set(key, expense)
    }
  }
  return new Map([...byMerchant].map(([key, expense]) => [key, expense.categoryId]))
}

function totals(entries: readonly { currency: string; amount: number }[]): Record<StatementCurrency, number> {
  const of = (currency: StatementCurrency) =>
    sumMoney(currency, entries.filter((e) => e.currency === currency).map((e) => money(e.amount, currency))).amount
  return { ARS: of('ARS'), USD: of('USD') }
}

/** The card a statement most likely belongs to: the one whose notes
 *  mention its account number, else the only one of its brand. */
export function guessCardFor(statement: Pick<ParsedStatement, 'account' | 'product'>, cards: readonly CreditCard[]): string | undefined {
  const active = cards.filter((c) => !c.isArchived)
  if (statement.account) {
    const byAccount = active.find((c) => c.notes?.includes(statement.account!))
    if (byAccount) return byAccount.id
  }
  const brand = statement.product?.split(' ')[0]?.toLowerCase().slice(0, 4)
  const byBrand = brand ? active.filter((c) => c.name.toLowerCase().includes(brand)) : []
  return byBrand.length === 1 ? byBrand[0]!.id : undefined
}

/**
 * Compares a parsed statement against what Moneta has for that card and
 * proposes what to import: each line as a gasto, an installment plan (from
 * the cuota the statement bills) or a charge — or as already loaded, a
 * credit that cancels a charge, or skipped.
 */
export async function buildImportPreview(statement: ParsedStatement, cardId: string): Promise<StatementImportPreview> {
  const period = monthOf(statement.closeDate)
  const [baseCalendar, categories, plans, allExpenses, datesLocked] = await Promise.all([
    creditCardsRepo.getCardCalendar(cardId),
    categoriesRepo.listActiveCategories('expense'),
    installmentPlansRepo.listInstallmentPlans(),
    expensesRepo.listExpensesInRange('0000-01-01', '9999-12-31'),
    statementImportRepo.statementDatesLocked(cardId, period),
  ])
  // Everything is placed with the statement's real dates — this one's and
  // the next's —, as importing will set them (unless a payment locks them).
  const realDates = [
    { period, closeDate: statement.closeDate, dueDate: statement.dueDate },
    ...(statement.nextCloseDate && statement.nextDueDate
      ? [{ period: shiftMonth(period, 1), closeDate: statement.nextCloseDate, dueDate: statement.nextDueDate }]
      : []),
  ]
  const calendar: CardCalendar = datesLocked
    ? baseCalendar
    : {
        ...baseCalendar,
        overrides: [...baseCalendar.overrides.filter((o) => !realDates.some((r) => r.period === o.period)), ...realDates],
      }
  const lastDay = lastPurchaseDay(calendar, period)

  const byName = new Map(categories.map((c) => [c.name, c] as [string, Category]))
  const chargesCategory = byName.get(CHARGES_CATEGORY_NAME)
  const fallback = byName.get('Otros') ?? categories[0]
  const lastCategory = lastCategoryByMerchant(allExpenses)
  function suggestCategory(description: string): string {
    const learned = lastCategory.get(merchantKey(description))
    if (learned && categories.some((c) => c.id === learned)) return learned
    const guessed = guessCategoryName(description)
    return (guessed && byName.get(guessed)?.id) ?? fallback?.id ?? ''
  }

  const cardExpenses = allExpenses.filter((e) => e.cardId === cardId)
  const cardPlans = plans.filter((p) => p.cardId === cardId)
  const installmentPlanIds = new Set(plans.map((p) => p.id))
  // A recurring gasto paid with the card (a subscription) is a gasto like
  // any other; only installment cuotas are matched through their plan.
  const candidates: DuplicateCandidate[] = cardExpenses
    .filter((e) => e.sourcePlanId === undefined || !installmentPlanIds.has(e.sourcePlanId))
    .map((e) => ({
      direction: 'out',
      amount: e.amount,
      currency: e.currency,
      date: e.date,
      ...(e.statementPeriod !== undefined && { period: e.statementPeriod }),
      label: e.description,
    }))
  const takenExpenses = new Set<number>()
  const takenPlans = new Set<string>()

  const rows: ImportRow[] = statement.items.map((item, index) => {
    const description = normalizeMerchant(item.description)
    const kind: ImportRowKind = item.section === 'charges' ? 'charge' : item.installment ? 'installment' : 'purchase'
    const row: ImportRow = {
      key: String(index),
      kind,
      status: 'new',
      suggested: true,
      credit: item.amount < 0,
      date: item.date,
      bookDate: item.date > lastDay ? lastDay : item.date,
      period,
      description: item.cashAdvance ? `${description} (adelanto en efectivo)` : description,
      original: item.description,
      currency: item.currency,
      amount: Math.abs(item.amount),
      ...(item.installment && { installment: item.installment }),
      categoryId: kind === 'charge' ? (chargesCategory?.id ?? '') : suggestCategory(description),
    }
    const skip = (note: string): ImportRow => ({ ...row, status: 'skipped', suggested: false, note })

    if (isPreviousPayment(item)) return skip('Pago del resumen anterior')
    if (item.amount === 0) return skip('Monto cero')
    if (item.amount < 0) return skip('Reintegro: Moneta no registra créditos')

    if (item.installment) {
      const { number, count } = item.installment
      const sameCuota = (p: (typeof cardPlans)[number]) =>
        !takenPlans.has(p.id) &&
        p.count === count &&
        p.currency === item.currency &&
        // The bank may put a remainder centavo on another cuota.
        Math.abs((p.scheduleCache[number - 1] ?? 0) - item.amount) <= 1
      const plan = cardPlans.find((p) => sameCuota(p) && p.purchaseDate === item.date)
      if (plan) {
        takenPlans.add(plan.id)
        return { ...row, status: 'loaded', suggested: false, note: `Ya está: "${plan.description}"` }
      }
      const landing = { ...row, period: installmentPlacement(calendar, item.date, number - 1).period }
      const near = cardPlans.find((p) => sameCuota(p) && Math.abs(daysBetween(p.purchaseDate, item.date)) <= PLAN_MATCH_WINDOW_DAYS)
      if (near) {
        takenPlans.add(near.id)
        return {
          ...landing,
          suggested: false,
          note: `Puede ser "${near.description}" (compra del ${formatShortDate(near.purchaseDate)}): tildalo sólo si es otra`,
        }
      }
      if (landing.period !== period) {
        return { ...landing, note: `Con los días de la tarjeta, esta cuota va al resumen de ${formatMonthLabel(landing.period).toLowerCase()}` }
      }
      return landing
    }

    const match = takeCandidate(candidates, takenExpenses, {
      direction: 'out',
      amount: item.amount,
      currency: item.currency,
      date: item.date,
      period,
    })
    if (match !== undefined) return { ...row, status: 'loaded', suggested: false, note: `Ya está: "${candidates[match]!.label}"` }
    return row
  })

  // A credit cancels a charge of the same merchant, amount and currency (a
  // refund, a tax reversed) — never a cuota: that would drop the plan.
  for (const credit of rows.filter((r) => r.credit && r.note?.startsWith('Reintegro'))) {
    const charge = rows.find(
      (r) =>
        !r.credit &&
        r.status === 'new' &&
        r.kind !== 'installment' &&
        r.currency === credit.currency &&
        r.amount === credit.amount &&
        r.description === credit.description,
    )
    if (!charge) continue
    credit.status = 'cancelled'
    credit.note = `Se cancela con "${charge.description}" del ${formatShortDate(charge.date)}`
    charge.status = 'cancelled'
    charge.suggested = false
    charge.note = 'Se cancela con un crédito del mismo monto'
  }

  // The statement as it will stand once its real dates re-place the card's
  // gastos (a cuota stays in its statement).
  const moved = new Map(
    datesLocked
      ? []
      : reassignedPeriods(
          cardExpenses.filter((e) => e.sourcePlanId === undefined),
          baseCalendar,
          calendar,
        ).map((m) => [m.id, m.statementPeriod]),
  )
  const existing = totals([
    ...cardExpenses.filter((e) => (moved.get(e.id) ?? e.statementPeriod) === period),
    ...openingBalanceOf(baseCalendar, period),
  ])
  const previousPayment = totals(statement.items.filter(isPreviousPayment))
  const bank = {
    ARS: statement.balance.ARS - statement.previousBalance.ARS - previousPayment.ARS,
    USD: statement.balance.USD - statement.previousBalance.USD - previousPayment.USD,
  }

  return {
    cardId,
    period,
    ...(statement.product !== undefined && { product: statement.product }),
    ...(statement.account !== undefined && { account: statement.account }),
    closeDate: statement.closeDate,
    dueDate: statement.dueDate,
    ...(statement.nextCloseDate !== undefined && { nextCloseDate: statement.nextCloseDate }),
    ...(statement.nextDueDate !== undefined && { nextDueDate: statement.nextDueDate }),
    rows,
    existing,
    bank,
    unread: unreadAmount(statement),
    datesLocked,
  }
}

export interface RowChoice {
  include: boolean
  categoryId: string
}

/** Whether a row can be imported at all (a credit, a payment or a zero
 *  amount never can) — loaded and cancelled ones only when ticked. */
export function isImportable(row: ImportRow): boolean {
  return !row.credit && row.status !== 'skipped'
}

/** The choices the preview opens with: what's suggested ticked, each
 *  with its suggested category. */
export function initialChoices(preview: StatementImportPreview): Map<string, RowChoice> {
  return new Map(preview.rows.map((r) => [r.key, { include: r.suggested, categoryId: r.categoryId }]))
}

function selectedRows(preview: StatementImportPreview, choices: ReadonlyMap<string, RowChoice>): ImportRow[] {
  return preview.rows.filter((r) => isImportable(r) && (choices.get(r.key)?.include ?? r.suggested))
}

/** The bank's total for the statement against Moneta's after importing
 *  what's ticked — equal means everything was accounted for. A cuota that
 *  lands in another statement doesn't count here. */
export function importCheck(preview: StatementImportPreview, choices: ReadonlyMap<string, RowChoice>): ImportCheck[] {
  const added = totals(selectedRows(preview, choices).filter((r) => r.period === preview.period))
  return CURRENCIES.map((currency) => ({
    currency,
    bank: preview.bank[currency],
    moneta: add(money(preview.existing[currency], currency), money(added[currency], currency)).amount,
  })).filter((c) => c.bank !== 0 || c.moneta !== 0)
}

/** Imports the ticked rows; returns how many gastos and plans it created. */
export async function importStatement(
  preview: StatementImportPreview,
  choices: ReadonlyMap<string, RowChoice>,
  today: DateStamp = todayStamp(),
): Promise<{ expenses: number; plans: number; datesSkipped: boolean }> {
  const selected = selectedRows(preview, choices)
  const categoryOf = (row: ImportRow): string | undefined => {
    const id = choices.get(row.key)?.categoryId ?? row.categoryId
    if (id !== '') return id
    // Only a charge may go without one: it gets the charges category.
    if (row.kind === 'charge') return undefined
    throw new Error(`Elegí una categoría para "${row.description}"`)
  }
  return statementImportRepo.applyStatementImport(
    {
      cardId: preview.cardId,
      period: preview.period,
      dates: { closeDate: preview.closeDate, dueDate: preview.dueDate },
      ...(preview.nextCloseDate &&
        preview.nextDueDate && { nextDates: { closeDate: preview.nextCloseDate, dueDate: preview.nextDueDate } }),
      fallbackCategoryName: CHARGES_CATEGORY_NAME,
      expenses: selected
        .filter((r) => r.kind !== 'installment')
        .map((r) => ({
          date: r.bookDate,
          description: r.description,
          categoryId: categoryOf(r),
          amount: r.amount,
          currency: r.currency,
          status: 'confirmed' as const,
          cardId: preview.cardId,
          statementPeriod: preview.period,
        })),
      plans: selected
        .filter((r) => r.kind === 'installment')
        .map((r) => {
          const { number, count } = r.installment!
          return {
            description: r.description,
            categoryId: categoryOf(r)!,
            currency: r.currency,
            // The bank's cuota × count: the cuotas still to come match it exactly.
            totalAmount: times(money(r.amount, r.currency), count).amount,
            count,
            firstDueDate: r.date,
            purchaseDate: r.date,
            cardId: preview.cardId,
            startIndex: number - 1,
          }
        }),
    },
    today,
  )
}
