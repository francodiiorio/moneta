import {
  accountAdjustmentsRepo,
  accountsRepo,
  cardStatementsRepo,
  categoriesRepo,
  creditCardsRepo,
  expensesRepo,
  importsRepo,
  incomesRepo,
  investmentLotsRepo,
  statementPaymentsRepo,
  transfersRepo,
} from '@/database/repositories'
import type { ExpenseInput } from '@/database/repositories/expenses.repo'
import type { IncomeInput } from '@/database/repositories/incomes.repo'
import { lastPurchaseDay, statementDates, statementPeriodFor, type StatementDates } from '@/domain/cards'
import { accountBalanceAt, movementAccountProblem, toAccountMovements } from '@/domain/accounts'
import type { Account, Category, CreditCard } from '@/domain/entities'
import { money, parseAmount, type CurrencyCode, type Money } from '@/domain/money'
import {
  addDays,
  formatMonthLabel,
  isValidMonthStamp,
  shiftMonth,
  todayStamp,
  type DateStamp,
  type MonthStamp,
} from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import { parseDateColumn } from './dateFormats'
import { duplicateKey, MATCH_WINDOW_DAYS, mentionedOwnName, takeCandidate, type DuplicateCandidate } from './matching'
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
  status: 'new' | 'duplicate' | 'invalid' | 'excluded'
  /** What a valid row becomes: a gasto, or (credits into an account with
   *  an income category) an ingreso. */
  kind?: 'expense' | 'income'
  invalidReason?: string
  /** For a 'duplicate': what it seems to duplicate ("Pago de resumen"). */
  duplicateOf?: string
  /** A new row that mentions another of the user's accounts or cards —
   *  likely a transfer or a card payment, unchecked by default. */
  ownMovement?: string
  /** What the UI should check by default: true for genuinely new rows,
   *  false for likely duplicates, unparseable rows, or excluded
   *  (income/credit) rows — the user opts a duplicate back in explicitly
   *  rather than opting bad/excluded rows in at all (their checkbox is
   *  disabled, see PreviewTable.tsx). */
  defaultSelected: boolean
}

/** Existing local gastos and ingresos in `[from, to]`, as the exact
 *  `duplicateKey`s a CSV row is checked against — so a
 *  re-imported/overlapping bank export doesn't create duplicates of
 *  movements already tracked. */
export async function loadExistingDuplicateKeys(from: DateStamp, to: DateStamp): Promise<Set<string>> {
  const [expenses, incomes] = await Promise.all([
    expensesRepo.listExpensesInRange(from, to),
    incomesRepo.listIncomesInRange(from, to),
  ])
  return new Set([
    ...expenses.map((e) => duplicateKey(e.date, e.amount, e.currency, e.description)),
    ...incomes.map((i) => duplicateKey(i.date, i.amount, i.currency, i.description, 'income')),
  ])
}

/** What `buildPreview` knows about the destination beyond the exact keys. */
export interface PreviewContext {
  /** Why a row dated `date` can't go to the destination, if so. */
  rowProblem?: (date: DateStamp) => string | undefined
  /** Movements already there, matched by amount (see matching.ts). */
  candidates?: readonly DuplicateCandidate[]
  /** For a card: the statement a row dated `date` lands in. */
  periodOf?: (date: DateStamp) => MonthStamp
  /** The user's other accounts and cards (see mentionedOwnName). */
  ownNames?: readonly string[]
}

/** `credit: true` marks a row whose amount is money coming in (an
 *  ingreso, a refund, a card payment). It only imports as an ingreso into
 *  an account with an income category; otherwise it's shown in the
 *  preview (so the user sees why) but can never be selected. */
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
  const importsCredits = mapping.destination.kind === 'account' && mapping.destination.incomeCategoryId !== ''
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

    const kind: 'expense' | 'income' = amountResult.credit ? 'income' : 'expense'
    if (amountResult.credit && !importsCredits) {
      return {
        index,
        raw,
        date,
        description,
        amount: amountResult.amount,
        status: 'excluded',
        kind,
        invalidReason:
          mapping.destination.kind === 'account'
            ? 'crédito — elegí una categoría de ingreso para importarlo'
            : 'crédito — no se importa',
        defaultSelected: false,
      }
    }

    const problem = context.rowProblem?.(date)
    if (problem) {
      return { index, raw, date, description, amount: amountResult.amount, status: 'invalid', kind, invalidReason: problem, defaultSelected: false }
    }

    const base = { index, raw, date, description, amount: amountResult.amount, kind }
    if (existingKeys.has(duplicateKey(date, amountResult.amount.amount, amountResult.amount.currency, description, kind))) {
      return { ...base, status: 'duplicate', defaultSelected: false }
    }
    const period = context.periodOf?.(date)
    const match = takeCandidate(context.candidates ?? [], taken, {
      direction: amountResult.credit ? 'in' : 'out',
      amount: amountResult.amount.amount,
      currency: amountResult.amount.currency,
      date,
      ...(period !== undefined && { period }),
    })
    if (match !== undefined) {
      const duplicateOf = context.candidates?.[match]?.label
      return { ...base, status: 'duplicate', ...(duplicateOf !== undefined && { duplicateOf }), defaultSelected: false }
    }
    const own = mentionedOwnName(description, context.ownNames ?? [])
    if (own !== undefined) return { ...base, status: 'new', ownMovement: own, defaultSelected: false }
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
    return buildPreview(rows, mapping, mapping.currency, new Set(), await destinationContext(mapping, undefined))
  }
  const from = parsedDates.reduce((min, d) => (d < min ? d : min))
  const to = parsedDates.reduce((max, d) => (d > max ? d : max))
  const [existingKeys, context] = await Promise.all([
    loadExistingDuplicateKeys(from, to),
    destinationContext(mapping, { from, to }),
  ])
  return buildPreview(rows, mapping, mapping.currency, existingKeys, context)
}

/** The destination's rules and what's already in it. */
async function destinationContext(
  mapping: CsvMapping,
  range: { from: DateStamp; to: DateStamp } | undefined,
): Promise<PreviewContext> {
  const { destination } = mapping
  if (destination.kind === 'account') {
    const [account, accounts, cards] = await Promise.all([
      accountsRepo.getAccount(destination.accountId),
      accountsRepo.listAccounts(),
      creditCardsRepo.listCreditCards(),
    ])
    invariant(account, `Cuenta no encontrada: ${destination.accountId}`)
    invariant(
      account.currency === mapping.currency,
      `La cuenta "${account.name}" es en ${account.currency}: importá el extracto en esa moneda`,
    )
    return {
      rowProblem: (date) => movementAccountProblem(account, { date, currency: mapping.currency }),
      candidates: range ? await accountCandidates(account.id, widen(range)) : [],
      ownNames: [...accounts.filter((a) => a.id !== account.id).map((a) => a.name), ...cards.map((c) => c.name)],
    }
  }
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

function widen(range: { from: DateStamp; to: DateStamp }) {
  return { from: addDays(range.from, -MATCH_WINDOW_DAYS), to: addDays(range.to, MATCH_WINDOW_DAYS) }
}

/** Everything already moving money in or out of the account around the
 *  file's dates: a bank row matching one by amount is likely it — a card
 *  payment or a transfer above all, which must never come back as a
 *  gasto or ingreso (they'd count twice). */
async function accountCandidates(accountId: string, range: { from: DateStamp; to: DateStamp }): Promise<DuplicateCandidate[]> {
  const [expenses, incomes, transfers, payments, lots] = await Promise.all([
    expensesRepo.listExpensesInRange(range.from, range.to),
    incomesRepo.listIncomesInRange(range.from, range.to),
    transfersRepo.listTransfersInRange(range.from, range.to),
    statementPaymentsRepo.listStatementPaymentsInRange(range.from, range.to),
    investmentLotsRepo.listLotsWithSourceInRange(range.from, range.to),
  ])
  return [
    ...expenses
      .filter((e) => e.accountId === accountId)
      .map((e) => ({ direction: 'out' as const, amount: e.amount, currency: e.currency, date: e.date, label: 'Gasto' })),
    ...incomes
      .filter((i) => i.accountId === accountId)
      .map((i) => ({ direction: 'in' as const, amount: i.amount, currency: i.currency, date: i.date, label: 'Ingreso' })),
    ...transfers.flatMap((t) => [
      ...(t.fromAccountId === accountId
        ? [{ direction: 'out' as const, amount: t.fromAmount, currency: t.fromCurrency, date: t.date, label: 'Transferencia' }]
        : []),
      ...(t.toAccountId === accountId
        ? [{ direction: 'in' as const, amount: t.toAmount, currency: t.toCurrency, date: t.date, label: 'Transferencia' }]
        : []),
    ]),
    ...payments
      .filter((p) => p.accountId === accountId)
      .map((p) => ({ direction: 'out' as const, amount: p.debitedAmount, currency: p.debitedCurrency, date: p.date, label: 'Pago de resumen' })),
    ...lots.flatMap((l) =>
      l.sourceAccountId === accountId && l.sourceAmount !== undefined && l.sourceCurrency !== undefined
        ? [{ direction: 'out' as const, amount: l.sourceAmount, currency: l.sourceCurrency, date: l.date, label: 'Compra de inversión' }]
        : [],
    ),
  ]
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

/** What an import can go to: active accounts and cards, and the income
 *  categories an account's credits can be imported with. */
export async function listImportTargets(): Promise<{ accounts: Account[]; cards: CreditCard[]; incomeCategories: Category[] }> {
  const [accounts, cards, incomeCategories] = await Promise.all([
    accountsRepo.listAccounts(),
    creditCardsRepo.listCreditCards(),
    categoriesRepo.listActiveCategories('income'),
  ])
  return { accounts: accounts.filter((a) => !a.isArchived), cards: cards.filter((c) => !c.isArchived), incomeCategories }
}

/** The last date of the file the user could have reconciled up to: every
 *  readable row's, imported or not — skipped duplicates are movements
 *  Moneta already has, so its balance at the file's end includes them. */
export function lastStatementDate(preview: readonly PreviewRow[]): DateStamp | undefined {
  return preview.reduce<DateStamp | undefined>(
    (max, row) => (row.status !== 'invalid' && row.date !== undefined && (max === undefined || row.date > max) ? row.date : max),
    undefined,
  )
}

/** Persists every row in `rows` — gastos (debit or card per the
 *  destination) and ingresos — all or nothing (see
 *  `imports.repo.ts:saveImportedMovements`). Callers must only pass rows
 *  that are `'new'` or `'duplicate'`; this throws instead of silently
 *  skipping if an `'invalid'`/`'excluded'` row slips through, since the UI
 *  should never make that possible (their checkbox is disabled). */
export async function importSelectedRows(
  rows: readonly PreviewRow[],
  mapping: CsvMapping,
): Promise<{ imported: number; expenses: number; incomes: number }> {
  const { destination } = mapping
  const expenses: ExpenseInput[] = []
  const incomes: IncomeInput[] = []
  for (const row of rows) {
    invariant(
      row.status !== 'invalid' && row.status !== 'excluded' && row.date && row.description && row.amount,
      `Fila inválida no debería llegar a importSelectedRows (índice ${row.index})`,
    )
    if (row.kind === 'income') {
      invariant(
        destination.kind === 'account' && destination.incomeCategoryId !== '',
        `Un crédito sólo se importa a una cuenta con categoría de ingreso (índice ${row.index})`,
      )
      incomes.push({
        date: row.date,
        description: row.description,
        categoryId: destination.incomeCategoryId,
        accountId: destination.accountId,
        amount: row.amount.amount,
        currency: row.amount.currency,
      })
      continue
    }
    expenses.push({
      date: row.date,
      description: row.description,
      categoryId: mapping.categoryId,
      amount: row.amount.amount,
      currency: row.amount.currency,
      status: 'confirmed',
      tags: [CSV_IMPORT_TAG],
      ...(destination.kind === 'account' && { accountId: destination.accountId }),
      ...(destination.kind === 'card' && { cardId: destination.cardId }),
      ...(destination.kind === 'card' && destination.statementPeriod !== '' && { statementPeriod: destination.statementPeriod }),
    })
  }

  await importsRepo.saveImportedMovements(expenses, incomes)
  return { imported: rows.length, expenses: expenses.length, incomes: incomes.length }
}

/** The account's balance at the end of `date`, as Moneta computes it —
 *  what the import's reconciliation compares against the bank's.
 *  `undefined` before its opening date. */
export async function getAccountBalanceAt(accountId: string, date: DateStamp): Promise<Money | undefined> {
  const [account, records] = await Promise.all([accountsRepo.getAccount(accountId), accountsRepo.listAccountMovementRecords()])
  if (!account) return undefined
  return accountBalanceAt(account, toAccountMovements(records), date)
}

export const RECONCILE_LABEL = 'Conciliación con el extracto'

/** Reconciles the account against the balance the bank's statement shows
 *  for `date`: the difference is stored as an "Ajustar saldo" adjustment
 *  (computed inside its write transaction). Returns it, or `undefined`
 *  when both already matched. */
export async function reconcileAccount(accountId: string, date: DateStamp, bankBalance: string): Promise<Money | undefined> {
  const account = await accountsRepo.getAccount(accountId)
  invariant(account, `Cuenta no encontrada: ${accountId}`)
  invariant(!/[()]/.test(bankBalance), 'Escribí un saldo negativo con signo menos, no entre paréntesis')
  return accountAdjustmentsRepo.createAdjustmentToReach({
    accountId,
    date,
    target: parseAmount(bankBalance, account.currency).amount,
    description: RECONCILE_LABEL,
  })
}
