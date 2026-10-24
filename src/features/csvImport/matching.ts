import { daysBetween, type DateStamp, type MonthStamp } from '@/lib/dates'

export type RowDirection = 'out' | 'in'

/** The exact match: same day, amount, currency and description (case and
 *  surrounding spaces aside). Ingresos are prefixed, so a credit only
 *  matches an ingreso. */
export function duplicateKey(
  date: DateStamp,
  amount: number,
  currency: string,
  description: string,
  kind: 'expense' | 'income' = 'expense',
): string {
  const key = `${date}|${amount}|${currency}|${description.trim().toLowerCase()}`
  return kind === 'income' ? `income|${key}` : key
}

/**
 * A movement already in the import's destination, matched by amount
 * rather than description: the bank's text ("COTO SUC 123", "MERCADOLIBRE
 * C.03/12") rarely equals what was typed by hand, and a card payment or a
 * transfer recorded in Moneta has no description of the bank's at all.
 */
export interface DuplicateCandidate {
  direction: RowDirection
  amount: number
  currency: string
  date: DateStamp
  /** For a card gasto: its statement — an installment's date is shifted
   *  months from the purchase the bank shows, but it's in the same one. */
  period?: MonthStamp
  /** What it is, for the preview ("Pago de resumen", "Transferencia"). */
  label: string
}

/** Days either side a bank's date may differ from Moneta's (weekends,
 *  processing). */
export const MATCH_WINDOW_DAYS = 3

/**
 * The first candidate not yet taken that a row matches: same direction,
 * amount and currency, and either within MATCH_WINDOW_DAYS or in the same
 * statement. Marks it as taken, so each existing movement covers at most
 * one row — two identical coffees in the file against one in Moneta leave
 * the second as new. Returns its index, or `undefined`.
 */
export function takeCandidate(
  candidates: readonly DuplicateCandidate[],
  taken: Set<number>,
  row: { direction: RowDirection; amount: number; currency: string; date: DateStamp; period?: MonthStamp },
): number | undefined {
  const index = candidates.findIndex(
    (c, i) =>
      !taken.has(i) &&
      c.direction === row.direction &&
      c.amount === row.amount &&
      c.currency === row.currency &&
      (Math.abs(daysBetween(c.date, row.date)) <= MATCH_WINDOW_DAYS ||
        (row.period !== undefined && c.period === row.period)),
  )
  if (index === -1) return undefined
  taken.add(index)
  return index
}

/** The first of `names` (the user's other accounts and cards) that the
 *  description mentions — a row like "PAGO VISA" or "TRANSF A BRUBANK" is
 *  likely money moving between the user's own accounts, which Moneta
 *  records as a statement payment or a transfer, never a gasto. Names
 *  shorter than 3 letters are ignored (too many false hits). */
export function mentionedOwnName(description: string, names: readonly string[]): string | undefined {
  const text = description.toLowerCase()
  return names.find((name) => name.trim().length >= 3 && text.includes(name.trim().toLowerCase()))
}
