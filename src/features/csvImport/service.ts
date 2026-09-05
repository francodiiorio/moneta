import { expensesRepo } from '@/database/repositories'
import type { ExpenseInput } from '@/database/repositories/expenses.repo'
import { money, parseAmount, type CurrencyCode, type Money } from '@/domain/money'
import type { DateStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import { parseDateColumn } from './dateFormats'
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
  invalidReason?: string
  /** What the UI should check by default: true for genuinely new rows,
   *  false for likely duplicates, unparseable rows, or excluded
   *  (income/credit) rows — the user opts a duplicate back in explicitly
   *  rather than opting bad/excluded rows in at all (their checkbox is
   *  disabled, see PreviewTable.tsx). */
  defaultSelected: boolean
}

function duplicateKey(date: DateStamp, amount: number, description: string): string {
  return `${date}|${amount}|${description.trim().toLowerCase()}`
}

/** Existing local expenses in `[from, to]`, as the same
 *  `date|amount|description` keys a CSV row is checked against — so a
 *  re-imported/overlapping bank export doesn't create duplicates of
 *  expenses already tracked. */
export async function loadExistingDuplicateKeys(from: DateStamp, to: DateStamp): Promise<Set<string>> {
  const expenses = await expensesRepo.listExpensesInRange(from, to)
  return new Set(expenses.map((e) => duplicateKey(e.date, e.amount, e.description)))
}

/** Sólo se trackean gastos — ver ADR "Simplificación: se elimina Cuentas,
 *  Ingresos y Transferencias" en docs/DECISIONS.md. `excluded: true`
 *  marca una fila cuyo monto representa un ingreso/crédito: se muestra en
 *  la vista previa (para que el usuario entienda por qué no se importa)
 *  pero nunca se puede seleccionar. */
function parseRowAmount(
  raw: string[],
  mapping: CsvMapping,
  currency: CurrencyCode,
): { amount: Money; excluded: boolean } | undefined {
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
    return { amount: money(Math.abs(parsed.amount), currency), excluded: !isExpense }
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
  return { amount: money(Math.abs(parsed.amount), currency), excluded: debitParsed === undefined }
}

/** Pure: given already-parsed rows, a confirmed mapping, the mapping's
 *  currency, and an already-fetched set of duplicate keys, computes what
 *  each row would become. Never touches the database. */
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
        ...(amountResult !== undefined && { amount: amountResult.amount }),
      }
    }

    if (amountResult.excluded) {
      return {
        index,
        raw,
        date,
        description,
        amount: amountResult.amount,
        status: 'excluded',
        invalidReason: 'no se importa — sólo se trackean gastos',
        defaultSelected: false,
      }
    }

    const status: PreviewRow['status'] = existingKeys.has(
      duplicateKey(date, amountResult.amount.amount, description),
    )
      ? 'duplicate'
      : 'new'

    return {
      index,
      raw,
      date,
      description,
      amount: amountResult.amount,
      status,
      defaultSelected: status === 'new',
    }
  })
}

/** Orchestrates the DB reads `buildPreview` needs (existing expenses to
 *  dedupe against) and calls it. */
export async function prepareImport(rows: readonly string[][], mapping: CsvMapping): Promise<PreviewRow[]> {
  const dataRows = mapping.hasHeaderRow ? rows.slice(1) : rows
  const parsedDates = dataRows
    .map((raw) => raw[mapping.dateColumn])
    .filter((cell): cell is string => cell !== undefined)
    .map((cell) => parseDateColumn(cell, mapping.dateFormat))
    .filter((d): d is DateStamp => d !== undefined)

  const existingKeys =
    parsedDates.length > 0
      ? await loadExistingDuplicateKeys(
          parsedDates.reduce((min, d) => (d < min ? d : min)),
          parsedDates.reduce((max, d) => (d > max ? d : max)),
        )
      : new Set<string>()

  return buildPreview(rows, mapping, mapping.currency, existingKeys)
}

/** Persists every row in `rows` as a real, confirmed gasto — all or
 *  nothing (see `expenses.repo.ts:bulkSaveExpenses`). Callers must only
 *  pass rows that are `'new'` or `'duplicate'`; this throws instead of
 *  silently skipping if an `'invalid'`/`'excluded'` row slips through,
 *  since the UI should never make that possible (their checkbox is
 *  disabled). */
export async function importSelectedRows(rows: readonly PreviewRow[], mapping: CsvMapping): Promise<{ imported: number }> {
  const inputs: ExpenseInput[] = rows.map((row) => {
    invariant(
      row.status !== 'invalid' && row.status !== 'excluded' && row.date && row.description && row.amount,
      `Fila inválida no debería llegar a importSelectedRows (índice ${row.index})`,
    )
    return {
      date: row.date,
      description: row.description,
      categoryId: mapping.categoryId,
      amount: row.amount.amount,
      currency: row.amount.currency,
      status: 'confirmed',
      tags: [CSV_IMPORT_TAG],
    }
  })

  await expensesRepo.bulkSaveExpenses(inputs)
  return { imported: inputs.length }
}
