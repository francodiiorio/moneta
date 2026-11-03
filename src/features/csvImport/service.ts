import {
  cardStatementsRepo,
  creditCardsRepo,
  expensesRepo,
  importsRepo,
  statementPaymentsRepo,
} from '@/database/repositories'
import type { ExpenseInput } from '@/database/repositories/expenses.repo'
import type { CreditCard } from '@/domain/entities'
import { lastPurchaseDay, statementDates, statementPeriodFor, type StatementDates } from '@/domain/cards'
import { money, parseAmount, type CurrencyCode, type Money } from '@/domain/money'
import {
  formatMonthLabel,
  isValidMonthStamp,
  shiftMonth,
  todayStamp,
  type DateStamp,
  type MonthStamp,
} from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import { parseDateColumn } from './dateFormats'
import { duplicateKey, takeCandidate, type DuplicateCandidate } from './matching'
import type { CsvMapping } from './schema'

/** A marker on every expense this feature creates, so they stay
 *  identifiable later (a backup export, a future "undo last import") —
 *  Expense.tags already exists for exactly this kind of free-form
 *  labeling, no schema change needed. */
export const CSV_IMPORT_TAG = 'csv-import'

export interface PreviewRow {
  /** Index into the raw parsed rows (stable across re-renders/sorts, and
   *  what the UI keys its selection state by). */
  index: number
  raw: string[]
  date?: DateStamp
  description?: string
  /** Magnitude only — always positive. */
  amount?: Money
  /** 'excluded': a credit (money that came in) — only gastos import. */
  status: 'new' | 'duplicate' | 'invalid' | 'excluded'
  invalidReason?: string
  /** For a 'duplicate': what it seems to duplicate ("Pago de resumen"). */
  duplicateOf?: string
  /** What the UI should check by default: true for genuinely new rows,
   *  false for likely duplicates, unparseable rows, or excluded
   *  (income/credit) rows — the user opts a duplicate back in explicitly
   *  rather than opting bad/excluded rows in at all (their checkbox is
   *  disabled, see PreviewTable.tsx). */
  defaultSelected: boolean
}

/** Existing local gastos in `[from, to]`, as the exact
 *  `duplicateKey`s a CSV row is checked against — so a
 *  re-imported/overlapping bank export doesn't create duplicates of
 *  movements already tracked. */
export async function loadExistingDuplicateKeys(from: DateStamp, to: DateStamp): Promise<Set<string>> {
  const expenses = await expensesRepo.listExpensesInRange(from, to)
  return new Set(expenses.map((e) => duplicateKey(e.date, e.amount, e.currency, e.description)))
}

/** What `buildPreview` knows about the destination beyond the exact keys. */
export interface PreviewContext {
  /** Why a row dated `date` can't go to the destination, if so. */
  rowProblem?: (date: DateStamp) => string | undefined
  /** Movements already there, matched by amount (see matching.ts). */
  candidates?: readonly DuplicateCandidate[]
  /** For a card: the statement a row dated `date` lands in. */
  periodOf?: (date: DateStamp) => MonthStamp
}

/** `credit: true` marks a row whose amount is money coming in (an
 *  ingreso, a refund, a card payment). It's shown in the preview (so the
 *  user sees why) but can never be selected: only gastos are imported. */
function parseRowAmount(
  raw: string[],
  mapping: CsvMapping,
  currency: CurrencyCode,
): { amount: Money; credit: boolean } | undefined {
  function tryParse(cell: string): Money | undefined {
    try {
      const parsed = parseAmount(cell, currency)
      return parsed.amount === 0 ? undefined : parsed
    } catch {
      return undefined
    }
  }

  if (mapping.amount.mode === 'single') {
    const cell = raw[mapping.amount.amountColumn]
    if (cell === undefined) return undefined
    const parsed = tryParse(cell)
    if (!parsed) return undefined
    const positiveMeansExpense = mapping.amount.signConvention === 'positive-is-expense'
    const isPositive = parsed.amount > 0
    const isExpense = isPositive === positiveMeansExpense
    return { amount: money(Math.abs(parsed.amount), currency), credit: !isExpense }
  }

  // "Has a value" means "parses to a non-zero amount", not "cell isn't an
  // empty string" — plenty of real bank exports write "0,00" in whichever
  // of débito/crédito doesn't apply to a row instead of leaving it blank,
  // and treating that as "filled" would wrongly flag every such row as
  // ambiguous (both columns "filled") even though the amount is
  // unambiguous.
  const debitParsed = tryParse(raw[mapping.amount.debitColumn] ?? '')
  const creditParsed = tryParse(raw[mapping.amount.creditColumn] ?? '')
  if ((debitParsed !== undefined) === (creditParsed !== undefined)) return undefined // both or neither — ambiguous

  const parsed = debitParsed ?? creditParsed
  invariant(parsed, 'unreachable: exactly one of debitParsed/creditParsed is defined here')
  return { amount: money(Math.abs(parsed.amount), currency), credit: debitParsed === undefined }
}

/** Pure: given already-parsed rows, a confirmed mapping, the mapping's
 *  currency, an already-fetched set of duplicate keys and what's known of
 *  the destination, computes what each row would become. Never touches
 *  the database. */
export function buildPreview(
  rows: readonly string[][],
  mapping: CsvMapping,
  currency: CurrencyCode,
  existingKeys: ReadonlySet<string>,
  context: PreviewContext = {},
): PreviewRow[] {
  const dataRows = mapping.hasHeaderRow ? rows.slice(1) : rows
  const indexOffset = mapping.hasHeaderRow ? 1 : 0
  const taken = new Set<number>()

  return dataRows.map((raw, i) => {
    const index = i + indexOffset
    const dateCell = raw[mapping.dateColumn]
    const date = dateCell !== undefined ? parseDateColumn(dateCell, mapping.dateFormat) : undefined
    const descriptionCell = raw[mapping.descriptionColumn]?.trim()
    const description = descriptionCell && descriptionCell.length > 0 ? descriptionCell : undefined
    const amountResult = parseRowAmount(raw, mapping, currency)

    if (!date || !description || !amountResult) {
      const reasons: string[] = []
      if (!date) reasons.push('fecha inválida')
      if (!description) reasons.push('descripción vacía')
      if (!amountResult) reasons.push('monto inválido')
      return {
        index,
        raw,
        status: 'invalid',
        invalidReason: reasons.join(', '),
        defaultSelected: false,
        ...(date !== undefined && { date }),
        ...(description !== undefined && { description }),
        ...(amountResult !== undefined && { amount: amountResult.amount }),
      }
    }

    if (amountResult.credit) {
      return {
        index,
        raw,
        date,
        description,
        amount: amountResult.amount,
        status: 'excluded',
        invalidReason: 'crédito — no se importa',
        defaultSelected: false,
      }
    }

    const problem = context.rowProblem?.(date)
    if (problem) {
      return { index, raw, date, description, amount: amountResult.amount, status: 'invalid', invalidReason: problem, defaultSelected: false }
    }

    const base = { index, raw, date, description, amount: amountResult.amount }
    if (existingKeys.has(duplicateKey(date, amountResult.amount.amount, amountResult.amount.currency, description))) {
      return { ...base, status: 'duplicate', defaultSelected: false }
    }
    const period = context.periodOf?.(date)
    const match = takeCandidate(context.candidates ?? [], taken, {
      direction: 'out',
      amount: amountResult.amount.amount,
      currency: amountResult.amount.currency,
      date,
      ...(period !== undefined && { period }),
    })
    if (match !== undefined) {
      const duplicateOf = context.candidates?.[match]?.label
      return { ...base, status: 'duplicate', ...(duplicateOf !== undefined && { duplicateOf }), defaultSelected: false }
    }
    return { ...base, status: 'new', defaultSelected: true }
  })
}

/** Orchestrates the DB reads `buildPreview` needs (existing movements to
 *  dedupe against, the destination's rules) and calls it. */
export async function prepareImport(rows: readonly string[][], mapping: CsvMapping): Promise<PreviewRow[]> {
  const dataRows = mapping.hasHeaderRow ? rows.slice(1) : rows
  const parsedDates = dataRows
    .map((raw) => raw[mapping.dateColumn])
    .filter((cell): cell is string => cell !== undefined)
    .map((cell) => parseDateColumn(cell, mapping.dateFormat))
    .filter((d): d is DateStamp => d !== undefined)
  if (parsedDates.length === 0) {
    return buildPreview(rows, mapping, mapping.currency, new Set(), await destinationContext(mapping))
  }
  const from = parsedDates.reduce((min, d) => (d < min ? d : min))
  const to = parsedDates.reduce((max, d) => (d > max ? d : max))
  const [existingKeys, context] = await Promise.all([
    loadExistingDuplicateKeys(from, to),
    destinationContext(mapping),
  ])
  return buildPreview(rows, mapping, mapping.currency, existingKeys, context)
}

/** The destination's rules and what's already in it. */
async function destinationContext(mapping: CsvMapping): Promise<PreviewContext> {
  const { destination } = mapping
  if (destination.kind === 'card') {
    const calendar = await creditCardsRepo.getCardCalendar(destination.cardId)
    const pinned = destination.statementPeriod === '' ? undefined : destination.statementPeriod
    // The last day the pinned statement takes (the close, or the day before
    // when the card sends closing-day purchases to the next one).
    const pinnedClose = pinned === undefined ? undefined : lastPurchaseDay(calendar, pinned)
    if (pinned !== undefined) invariant(isValidMonthStamp(pinned), `Resumen inválido: ${pinned}`)
    const paid = new Set((await statementPaymentsRepo.listStatementPayments(destination.cardId)).map((p) => p.period))
    const periodOf = (date: DateStamp) => pinned ?? statementPeriodFor(calendar, date)
    const expenses = await cardStatementsRepo.listCardExpenses(destination.cardId)
    return {
      // A paid statement takes no imported gastos (they'd shift its difference
      // with what was paid unnoticed — what the bank charged beyond Moneta is
      // reconciled from the statement instead), and a pinned one can't take
      // a purchase after its last purchase day.
      rowProblem: (date) => {
        if (pinnedClose !== undefined && date > pinnedClose) {
          return calendar.card.closingDayToNext
            ? 'del día de cierre o posterior: va al resumen siguiente'
            : 'posterior al cierre del resumen elegido'
        }
        const period = periodOf(date)
        return paid.has(period)
          ? `el resumen de ${formatMonthLabel(period).toLowerCase()} ya está pagado — conciliá la diferencia desde el resumen`
          : undefined
      },
      periodOf,
      candidates: expenses.map((e) => ({
        direction: 'out' as const,
        amount: e.amount,
        currency: e.currency,
        date: e.date,
        ...(e.statementPeriod !== undefined && { period: e.statementPeriod }),
        label: 'Gasto',
      })),
    }
  }
  return {}
}

export interface StatementChoice extends StatementDates {
  /** A paid statement can't take imported gastos. */
  paid: boolean
  /** It has the card's opening balance — what was owed before Moneta, as
   *  a total: importing its gastos too would count them twice. */
  hasOpening: boolean
}

/** The statements a card import can pin every row to: the open one and
 *  the three before it — the bank's statement CSV is usually the last
 *  closed one. Newest first. */
export async function cardStatementChoices(cardId: string, today: DateStamp = todayStamp()): Promise<StatementChoice[]> {
  const [calendar, payments] = await Promise.all([
    creditCardsRepo.getCardCalendar(cardId),
    statementPaymentsRepo.listStatementPayments(cardId),
  ])
  const open = statementPeriodFor(calendar, today)
  return [0, -1, -2, -3].map((offset) => {
    const dates = statementDates(calendar, shiftMonth(open, offset))
    return {
      ...dates,
      paid: payments.some((p) => p.period === dates.period),
      hasOpening: (calendar.card.openingBalances ?? []).some((b) => b.period === dates.period),
    }
  })
}

/** What an import can go to: active cards. */
export async function listImportTargets(): Promise<{ cards: CreditCard[] }> {
  const cards = await creditCardsRepo.listCreditCards()
  return { cards: cards.filter((c) => !c.isArchived) }
}

/** Persists every row in `rows` as a gasto (card per the destination),
 *  all or nothing (see `imports.repo.ts:saveImportedMovements`). Callers
 *  must only pass rows that are `'new'` or `'duplicate'`; this throws
 *  instead of silently skipping if an `'invalid'`/`'excluded'` row slips
 *  through, since the UI should never make that possible (their checkbox
 *  is disabled). */
export async function importSelectedRows(rows: readonly PreviewRow[], mapping: CsvMapping): Promise<{ imported: number }> {
  const { destination } = mapping
  const expenses: ExpenseInput[] = []
  for (const row of rows) {
    invariant(
      row.status !== 'invalid' && row.status !== 'excluded' && row.date && row.description && row.amount,
      `Fila inválida no debería llegar a importSelectedRows (índice ${row.index})`,
    )
    expenses.push({
      date: row.date,
      description: row.description,
      categoryId: mapping.categoryId,
      amount: row.amount.amount,
      currency: row.amount.currency,
      status: 'confirmed',
      tags: [CSV_IMPORT_TAG],
      ...(destination.kind === 'card' && { cardId: destination.cardId }),
      ...(destination.kind === 'card' && destination.statementPeriod !== '' && { statementPeriod: destination.statementPeriod }),
    })
  }

  await importsRepo.saveImportedMovements(expenses, [])
  return { imported: rows.length }
}
