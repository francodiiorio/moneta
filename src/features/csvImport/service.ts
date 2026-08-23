import { accountsRepo, transactionsRepo } from '@/database/repositories'
import { buildExpense, buildIncome, type LedgerEntryDraft } from '@/domain/ledger'
import { money, parseAmount, type CurrencyCode, type Money } from '@/domain/money'
import type { Transaction } from '@/domain/entities'
import type { DateStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import { parseDateColumn } from './dateFormats'
import type { CsvMapping } from './schema'

/** A marker on every transaction this feature creates, so they stay
 *  identifiable later (a backup export, a future "undo last import") —
 *  Transaction.tags already exists for exactly this kind of free-form
 *  labeling, no schema change needed. */
export const CSV_IMPORT_TAG = 'csv-import'

export interface PreviewRow {
  /** Index into the raw parsed rows (stable across re-renders/sorts, and
   *  what the UI keys its selection state by). */
  index: number
  raw: string[]
  date?: DateStamp
  description?: string
  /** Magnitude only — always positive; `kind` carries the sign. */
  amount?: Money
  kind?: Transaction['kind']
  status: 'new' | 'duplicate' | 'invalid'
  invalidReason?: string
  /** What the UI should check by default: true for genuinely new rows,
   *  false for likely duplicates or unparseable rows (the user opts
   *  those back in explicitly rather than opting bad rows out). */
  defaultSelected: boolean
}

function duplicateKey(date: DateStamp, signedAmount: number, description: string): string {
  return `${date}|${signedAmount}|${description.trim().toLowerCase()}`
}

/** Existing local transactions for `accountId` in `[from, to]`, as the
 *  same `date|signedAmount|description` keys a CSV row is checked
 *  against — so a re-imported/overlapping bank export doesn't create
 *  duplicates of movements already in the ledger. */
export async function loadExistingDuplicateKeys(
  accountId: string,
  from: DateStamp,
  to: DateStamp,
): Promise<Set<string>> {
  const items = await transactionsRepo.listTransactionsInRange(from, to)
  const keys = new Set<string>()
  for (const { transaction, postings } of items) {
    const accountPosting = postings.find((p) => p.target === 'account' && p.accountId === accountId)
    if (!accountPosting) continue
    keys.add(duplicateKey(transaction.date, accountPosting.amount, transaction.description))
  }
  return keys
}

function parseRowAmount(
  raw: string[],
  mapping: CsvMapping,
  currency: CurrencyCode,
): { amount: Money; kind: 'expense' | 'income' } | undefined {
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
    const positiveMeansIncome = mapping.amount.signConvention === 'positive-is-income'
    const isPositive = parsed.amount > 0
    const kind = isPositive === positiveMeansIncome ? 'income' : 'expense'
    return { amount: money(Math.abs(parsed.amount), currency), kind }
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
  return { amount: money(Math.abs(parsed.amount), currency), kind: debitParsed !== undefined ? 'expense' : 'income' }
}

/** Pure: given already-parsed rows, a confirmed mapping, the target
 *  account's currency, and an already-fetched set of duplicate keys,
 *  computes what each row would become. Never touches the database. */
export function buildPreview(
  rows: readonly string[][],
  mapping: CsvMapping,
  currency: CurrencyCode,
  existingKeys: ReadonlySet<string>,
): PreviewRow[] {
  const dataRows = mapping.hasHeaderRow ? rows.slice(1) : rows
  const indexOffset = mapping.hasHeaderRow ? 1 : 0

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
        ...(amountResult !== undefined && { amount: amountResult.amount, kind: amountResult.kind }),
      }
    }

    const signedAmount = amountResult.kind === 'expense' ? amountResult.amount.amount * -1 : amountResult.amount.amount
    const status: PreviewRow['status'] = existingKeys.has(duplicateKey(date, signedAmount, description))
      ? 'duplicate'
      : 'new'

    return {
      index,
      raw,
      date,
      description,
      amount: amountResult.amount,
      kind: amountResult.kind,
      status,
      defaultSelected: status === 'new',
    }
  })
}

/** Orchestrates the DB reads `buildPreview` needs (account currency,
 *  existing transactions to dedupe against) and calls it. */
export async function prepareImport(rows: readonly string[][], mapping: CsvMapping): Promise<PreviewRow[]> {
  const accounts = await accountsRepo.listAccountsWithBalances()
  const account = accounts.find((a) => a.id === mapping.accountId)
  invariant(account, `Cuenta no encontrada: ${mapping.accountId}`)

  const dataRows = mapping.hasHeaderRow ? rows.slice(1) : rows
  const parsedDates = dataRows
    .map((raw) => raw[mapping.dateColumn])
    .filter((cell): cell is string => cell !== undefined)
    .map((cell) => parseDateColumn(cell, mapping.dateFormat))
    .filter((d): d is DateStamp => d !== undefined)

  const existingKeys =
    parsedDates.length > 0
      ? await loadExistingDuplicateKeys(
          mapping.accountId,
          parsedDates.reduce((min, d) => (d < min ? d : min)),
          parsedDates.reduce((max, d) => (d > max ? d : max)),
        )
      : new Set<string>()

  return buildPreview(rows, mapping, account.currency, existingKeys)
}

/** Persists every row in `rows` as a real, confirmed transaction — all or
 *  nothing (see `transactions.repo.ts:bulkSaveTransactions`). Callers
 *  must only pass rows that are not `'invalid'`; this throws instead of
 *  silently skipping if one slips through, since the UI should never
 *  make that possible (an invalid row's checkbox is disabled). */
export async function importSelectedRows(rows: readonly PreviewRow[], mapping: CsvMapping): Promise<{ imported: number }> {
  const entries: LedgerEntryDraft[] = rows.map((row) => {
    invariant(
      row.status !== 'invalid' && row.date && row.description && row.amount && row.kind,
      `Fila inválida no debería llegar a importSelectedRows (índice ${row.index})`,
    )
    const base = { date: row.date, description: row.description, tags: [CSV_IMPORT_TAG] }
    return row.kind === 'expense'
      ? buildExpense({ ...base, accountId: mapping.accountId, categoryId: mapping.expenseCategoryId, amount: row.amount })
      : buildIncome({ ...base, accountId: mapping.accountId, categoryId: mapping.incomeCategoryId, amount: row.amount })
  })

  await transactionsRepo.bulkSaveTransactions(entries)
  return { imported: entries.length }
}
