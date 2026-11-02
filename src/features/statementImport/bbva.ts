import { isValidDateStamp, type DateStamp } from '@/lib/dates'

/** A piece of text on a page: where it starts (PDF points from the
 *  left) and, when known, how wide it is. */
export interface StatementToken {
  x: number
  width?: number
  text: string
}

/** The tokens of one visual line, left to right — see `groupTokensIntoLines`. */
export type StatementLine = readonly StatementToken[]

export type StatementSection = 'payments' | 'purchases' | 'charges'
export type StatementCurrency = 'ARS' | 'USD'

export interface ParsedStatementItem {
  section: StatementSection
  date: DateStamp
  /** As printed ("DLO*RAPPI", "IMPUESTO DE SELLOS $"). */
  description: string
  coupon?: string
  /** "C.07/12": cuota 7 of 12. */
  installment?: { number: number; count: number }
  /** "(ADEL.)": a cash advance, billed with interest. */
  cashAdvance: boolean
  currency: StatementCurrency
  /** Minor units; negative for a credit (a refund, a payment). */
  amount: number
}

export interface ParsedStatement {
  /** "Visa Gold", "Mastercard Gold". */
  product?: string
  account?: string
  closeDate: DateStamp
  dueDate: DateStamp
  /** What the bank prints as "próximo cierre / vencimiento". */
  nextCloseDate?: DateStamp
  nextDueDate?: DateStamp
  balance: Record<StatementCurrency, number>
  previousBalance: Record<StatementCurrency, number>
  items: ParsedStatementItem[]
}

export class StatementParseError extends Error {}

/** Per currency, what the read lines don't account for: the previous
 *  balance plus every line should be the current balance. Not zero means
 *  some line of the PDF wasn't read. */
export function unreadAmount(statement: Pick<ParsedStatement, 'balance' | 'previousBalance' | 'items'>): Record<StatementCurrency, number> {
  const gap = { ARS: statement.balance.ARS - statement.previousBalance.ARS, USD: statement.balance.USD - statement.previousBalance.USD }
  for (const item of statement.items) gap[item.currency] -= item.amount
  return gap
}

const DATE = /^(\d{2})-([A-Za-zÁÉÍÓÚáéíóú]{3})-(\d{2})$/
// With or without thousands separators ("1.003.759,57", "1003759,57").
const AMOUNT = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/
const CUOTA = /^C\.(\d{2})\/(\d{2})$/
const COUPON = /^\d{5,}$/
const MONTHS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
}
// Left of this: the barcode some pages print beside a row. Right of this:
// the bank's footer. Neither is part of a statement line.
const MIN_X = 58
const MAX_X = 575
// Amounts are right-aligned under their column header, starting a bit left
// of it; anything further left (a coupon number, an amount inside a
// description like "DB IVA $ 21% 14.064,63") isn't the line's amount.
const AMOUNT_COLUMN_SLACK = 48

/** "06-Abr-26" → "2026-04-06". */
export function parseStatementDate(raw: string): DateStamp | undefined {
  const match = DATE.exec(raw.trim())
  if (!match) return undefined
  const month = MONTHS[match[2]!.toLowerCase()]
  if (month === undefined) return undefined
  const stamp = `20${match[3]}-${String(month).padStart(2, '0')}-${match[1]}`
  return isValidDateStamp(stamp) ? stamp : undefined
}

/** "1.003.759,57" → 100375957, "-180,06" → -18006 — read digit by digit,
 *  never through a float. */
export function parseStatementAmount(raw: string): number | undefined {
  const text = raw.trim()
  if (!AMOUNT.test(text)) return undefined
  const negative = text.startsWith('-')
  const [units, cents] = text.replace('-', '').replaceAll('.', '').split(',') as [string, string]
  const value = Number(units) * 100 + Number(cents)
  if (!Number.isSafeInteger(value)) return undefined
  return negative ? -value : value
}

function lineText(line: StatementLine): string {
  return line.map((t) => t.text).join(' ')
}

function tokenAt(line: StatementLine, x: number): StatementToken | undefined {
  return line.reduce<StatementToken | undefined>(
    (best, t) => (best === undefined || Math.abs(t.x - x) < Math.abs(best.x - x) ? t : best),
    undefined,
  )
}

/** The first of the few lines after `index` that holds values (a date or
 *  an amount) — a caption ("Otros períodos") can sit in between. */
function valuesAfter(lines: readonly StatementLine[], index: number): StatementLine | undefined {
  return lines.slice(index + 1, index + 4).find((line) => line.some((t) => DATE.test(t.text) || AMOUNT.test(t.text)))
}

/** The value printed under `label` on the values line after `labels` —
 *  the bank's summary boxes are a row of labels over a row of values. */
function valueUnder(labels: StatementLine, values: StatementLine | undefined, label: string): string | undefined {
  const header = labels.find((t) => t.text === label)
  if (!header || !values) return undefined
  return tokenAt(values, header.x)?.text
}

function findLine(lines: readonly StatementLine[], test: (text: string) => boolean): number {
  return lines.findIndex((line) => test(lineText(line)))
}

/**
 * Reads a BBVA Argentina credit card statement (Visa or Mastercard) from
 * its text lines: the close/due dates and balances of the summary, the
 * next close/due date, and every line of the detail — payments and
 * credits, purchases (with their cuota) and taxes/charges. Throws
 * StatementParseError (user-facing, Spanish) when it doesn't look like
 * one.
 */
export function parseBbvaStatement(lines: readonly StatementLine[]): ParsedStatement {
  const headerIndex = findLine(lines, (t) => t.includes('CIERRE ACTUAL') && t.includes('VENCIMIENTO ACTUAL'))
  if (headerIndex < 0) {
    throw new StatementParseError('No parece un resumen de tarjeta de BBVA: no se encontró el cierre actual')
  }
  const header = lines[headerIndex]!
  const headerValues = valuesAfter(lines, headerIndex)
  const closeDate = parseStatementDate(valueUnder(header, headerValues, 'CIERRE ACTUAL') ?? '')
  const dueDate = parseStatementDate(valueUnder(header, headerValues, 'VENCIMIENTO ACTUAL') ?? '')
  if (!closeDate || !dueDate) {
    throw new StatementParseError('No se pudieron leer las fechas de cierre y vencimiento del resumen')
  }
  const balance = {
    ARS: parseStatementAmount(valueUnder(header, headerValues, 'SALDO ACTUAL $') ?? '') ?? 0,
    USD: parseStatementAmount(valueUnder(header, headerValues, 'SALDO ACTUAL U$S') ?? '') ?? 0,
  }

  const accountLine = lines.find((line) => line.some((t) => /^cuenta \d+$/.test(t.text)))
  const account = accountLine?.find((t) => /^cuenta \d+$/.test(t.text))?.text.replace('cuenta ', '')
  const product = accountLine?.[0]?.text

  const nextIndex = findLine(lines, (t) => t.includes('PRÓXIMO CIERRE'))
  const nextLabels = nextIndex >= 0 ? lines[nextIndex]! : []
  const nextValues = nextIndex >= 0 ? valuesAfter(lines, nextIndex) : undefined
  const nextCloseDate = parseStatementDate(valueUnder(nextLabels, nextValues, 'PRÓXIMO CIERRE') ?? '')
  const nextDueDate = parseStatementDate(valueUnder(nextLabels, nextValues, 'PRÓXIMO VENCIMIENTO') ?? '')

  // The summary's two columns ("Pesos", "Dólares") split the previous balance by currency.
  const previousBalance = { ARS: 0, USD: 0 }
  const summaryColumns = lines.find((line) => line.some((t) => t.text === 'Pesos') && line.some((t) => t.text === 'Dólares'))
  const previousLine = lines.find((line) => line[0]?.text === 'SALDO ANTERIOR')
  if (summaryColumns && previousLine) {
    const split = (summaryColumns.find((t) => t.text === 'Pesos')!.x + summaryColumns.find((t) => t.text === 'Dólares')!.x) / 2
    for (const token of previousLine) {
      const amount = parseStatementAmount(token.text)
      if (amount !== undefined) previousBalance[token.x < split ? 'ARS' : 'USD'] = amount
    }
  }

  const items: ParsedStatementItem[] = []
  const detailStart = findLine(lines, (t) => t.trim() === 'DETALLE')
  let section: StatementSection | undefined
  let pesosX: number | undefined
  let dollarsX: number | undefined
  let couponX: number | undefined
  // Amounts are right-aligned under their header: their right edges
  // decide the column, when the PDF gives widths.
  let pesosRight: number | undefined
  let dollarsRight: number | undefined
  // A row the page break split: its date alone on one line, the rest on the next.
  let pendingDate: DateStamp | undefined

  for (const raw of lines.slice(detailStart >= 0 ? detailStart + 1 : headerIndex + 2)) {
    const text = lineText(raw).trim()
    if (text.startsWith('Legales y avisos')) break
    if (text.startsWith('Sus pagos y ajustes')) {
      section = 'payments'
      continue
    }
    if (text.startsWith('Consumos')) {
      section = 'purchases'
      continue
    }
    if (text.startsWith('Impuestos, cargos e intereses')) {
      section = 'charges'
      continue
    }
    const pesos = raw.find((t) => t.text === 'PESOS')
    const dollars = raw.find((t) => t.text === 'DÓLARES')
    if (pesos && dollars) {
      pesosX = pesos.x
      dollarsX = dollars.x
      pesosRight = pesos.width !== undefined ? pesos.x + pesos.width : undefined
      dollarsRight = dollars.width !== undefined ? dollars.x + dollars.width : undefined
      couponX = raw.find((t) => t.text === 'NRO. CUPÓN')?.x ?? couponX
      continue
    }
    if (section === undefined || pesosX === undefined || dollarsX === undefined) continue

    const tokens = raw.filter((t) => t.x >= MIN_X && t.x < MAX_X)
    const amountMinX = pesosX - AMOUNT_COLUMN_SLACK
    const dateToken = tokens.find((t) => t.x < 100 && DATE.test(t.text))
    const amounts = tokens.filter((t) => t.x >= amountMinX && AMOUNT.test(t.text))
    const rest = tokens.filter((t) => t !== dateToken && t.x >= 100 && t.x < amountMinX)
    const installmentToken = rest.find((t) => CUOTA.test(t.text))
    const couponToken = rest.find((t) => COUPON.test(t.text) && (couponX === undefined || t.x >= couponX - 25))
    const cashAdvance = rest.some((t) => t.text === '(ADEL.)')
    const descriptionTokens = rest.filter((t) => t !== installmentToken && t !== couponToken && t.text !== '(ADEL.)')

    if (dateToken && amounts.length === 0) {
      // Only a date: the row continues on a later line. A dated line
      // with text but no amount is a note ("(CREDITO PROV. ...)").
      pendingDate = descriptionTokens.length === 0 ? parseStatementDate(dateToken.text) : undefined
      continue
    }
    // Without its own date or amount, a line is page furniture (a footer,
    // a total): it doesn't consume a pending date.
    if (amounts.length === 0 || descriptionTokens.length === 0) continue
    const date = dateToken ? parseStatementDate(dateToken.text) : pendingDate
    pendingDate = undefined
    if (!date) continue

    const amountToken = amounts[amounts.length - 1]!
    const installment = installmentToken ? CUOTA.exec(installmentToken.text) : null
    items.push({
      section,
      date,
      // A purchase in dollars also prints its original amount ("USD 5,90").
      description: descriptionTokens.map((t) => t.text).join(' ').replace(/\s+USD\s+[\d.,]+$/, '').trim(),
      ...(couponToken && { coupon: couponToken.text }),
      ...(installment && { installment: { number: Number(installment[1]), count: Number(installment[2]) } }),
      cashAdvance,
      currency:
        pesosRight !== undefined && dollarsRight !== undefined && amountToken.width !== undefined
          ? Math.abs(amountToken.x + amountToken.width - pesosRight) <= Math.abs(amountToken.x + amountToken.width - dollarsRight)
            ? 'ARS'
            : 'USD'
          : amountToken.x < (pesosX + dollarsX) / 2
            ? 'ARS'
            : 'USD',
      amount: parseStatementAmount(amountToken.text)!,
    })
  }

  return {
    ...(product !== undefined && { product }),
    ...(account !== undefined && { account }),
    closeDate,
    dueDate,
    ...(nextCloseDate !== undefined && { nextCloseDate }),
    ...(nextDueDate !== undefined && { nextDueDate }),
    balance,
    previousBalance,
    items,
  }
}

/**
 * Groups positioned text into visual lines, top to bottom, left to right:
 * sweeping down the page, a token starts a new line when it sits more than
 * `tolerance` points below the previous one. Chained, not anchored to a
 * line's first token: a row's amount sits a bit lower than its date, and
 * a footer a bit higher. Pages are read in order. Pure, so the PDF reader
 * stays a thin adapter.
 */
export function groupTokensIntoLines(
  pages: readonly (readonly { x: number; y: number; width?: number; text: string }[])[],
  tolerance = 2,
): StatementLine[] {
  const lines: StatementLine[] = []
  for (const page of pages) {
    const items = page.filter((item) => item.text.trim()).sort((a, b) => b.y - a.y)
    let current: StatementToken[] = []
    let previousY: number | undefined
    for (const item of items) {
      if (previousY !== undefined && previousY - item.y > tolerance) {
        lines.push(current.sort((a, b) => a.x - b.x))
        current = []
      }
      // NFC: some PDFs spell "Ó" as "O" plus a combining accent.
      current.push({
        x: item.x,
        ...(item.width !== undefined && { width: item.width }),
        text: item.text.trim().normalize('NFC'),
      })
      previousY = item.y
    }
    if (current.length > 0) lines.push(current.sort((a, b) => a.x - b.x))
  }
  return lines
}
