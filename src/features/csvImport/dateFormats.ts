import { isValid, parse } from 'date-fns'
import { toDateStamp, type DateStamp } from '@/lib/dates'

export type CsvDateFormat = 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'

export const CSV_DATE_FORMATS: { value: CsvDateFormat; label: string }[] = [
  { value: 'dd/MM/yyyy', label: 'DD/MM/AAAA (Argentina y la mayoría de los bancos locales)' },
  { value: 'MM/dd/yyyy', label: 'MM/DD/AAAA (formato estadounidense)' },
  { value: 'yyyy-MM-dd', label: 'AAAA-MM-DD (ISO)' },
]

/** A raw date column value like "23/08/2026" is genuinely ambiguous
 *  between banks/locales (23/08 vs 08/23) — there's no reliable way to
 *  auto-detect it, so the user picks the format explicitly instead of a
 *  heuristic guessing wrong in a way that's hard to notice. Returns
 *  `undefined` for anything that doesn't parse as a real calendar date
 *  in that format (garbage/summary rows, empty cells). */
export function parseDateColumn(raw: string, format: CsvDateFormat): DateStamp | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const parsed = parse(trimmed, format, new Date())
  if (!isValid(parsed)) return undefined
  return toDateStamp(parsed)
}
