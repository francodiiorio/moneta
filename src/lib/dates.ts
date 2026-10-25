import {
  addDays as addCalendarDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  formatDistanceToNow,
  getDaysInMonth,
  parse,
  startOfMonth,
  startOfYear,
} from 'date-fns'
import { es } from 'date-fns/locale'

/** A calendar day with no timezone attached, e.g. "2026-08-23". */
export type DateStamp = string

/** A calendar month, e.g. "2026-08". */
export type MonthStamp = string

/** A calendar year, e.g. "2026". */
export type YearStamp = string

const DATE_FORMAT = 'yyyy-MM-dd'
const MONTH_FORMAT = 'yyyy-MM'
const YEAR_FORMAT = 'yyyy'

export function todayStamp(): DateStamp {
  return format(new Date(), DATE_FORMAT)
}

export function toDateStamp(date: Date): DateStamp {
  return format(date, DATE_FORMAT)
}

/** Parses a DateStamp as local midnight (never UTC — avoids off-by-one-day bugs). */
export function fromDateStamp(stamp: DateStamp): Date {
  return parse(stamp, DATE_FORMAT, new Date())
}

export function monthOf(stamp: DateStamp): MonthStamp {
  return stamp.slice(0, 7)
}

export function currentMonthStamp(): MonthStamp {
  return format(startOfMonth(new Date()), MONTH_FORMAT)
}

export function isValidDateStamp(value: string): value is DateStamp {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  // Same guard as isValidMonthStamp: "2026-02-31" matches the shape but
  // parses to an Invalid Date, and format() throws RangeError on one.
  const parsed = fromDateStamp(value)
  if (Number.isNaN(parsed.getTime())) return false
  return toDateStamp(parsed) === value
}

function monthStart(month: MonthStamp): Date {
  return parse(month, MONTH_FORMAT, new Date())
}

/** Guards a MonthStamp coming from untrusted input (e.g. a URL param).
 *  The NaN check isn't redundant with the regex: date-fns parses
 *  "2026-13"/"2026-00"/"0000-01" to an Invalid Date (they still match the
 *  shape), and `format()` throws RangeError on one — so the round-trip
 *  below must never run on it. */
export function isValidMonthStamp(value: string): value is MonthStamp {
  if (!/^\d{4}-\d{2}$/.test(value)) return false
  const parsed = monthStart(value)
  if (Number.isNaN(parsed.getTime())) return false
  return format(parsed, MONTH_FORMAT) === value
}

export function monthRange(month: MonthStamp): { start: DateStamp; end: DateStamp } {
  const start = monthStart(month)
  return { start: toDateStamp(start), end: toDateStamp(endOfMonth(start)) }
}

export function shiftMonth(month: MonthStamp, delta: number): MonthStamp {
  return format(addMonths(monthStart(month), delta), MONTH_FORMAT)
}

export function formatMonthLabel(month: MonthStamp): string {
  const label = format(monthStart(month), 'LLLL yyyy', { locale: es })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function formatShortDate(date: DateStamp): string {
  return format(fromDateStamp(date), 'dd/MM')
}

/** `dd/mm/aaaa` — the app's one date display format, regardless of the
 *  browser's own locale (see `components/DateField`, which never uses
 *  the native `<input type="date">` for exactly this reason). */
export function formatFullDate(date: DateStamp): string {
  return format(fromDateStamp(date), 'dd/MM/yyyy', { locale: es })
}

/** Full, spoken-style date (e.g. "sábado, 1 de agosto de 2026") for
 *  accessibility labels — takes a raw `Date` since callers like a
 *  calendar widget work with `Date` objects, not `DateStamp` strings. */
export function formatSpokenDate(date: Date): string {
  return format(date, 'PPPP', { locale: es })
}

export function formatMonthShort(month: MonthStamp): string {
  const label = format(monthStart(month), 'LLL', { locale: es })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** "hace 3 horas" style relative time from an ISO instant — used for
 *  "última actualización" indicators (e.g. Cotizaciones). */
export function formatRelativeTime(isoInstant: string): string {
  return formatDistanceToNow(new Date(isoInstant), { addSuffix: true, locale: es })
}

export function currentYearStamp(): YearStamp {
  return format(new Date(), YEAR_FORMAT)
}

export function yearRange(year: YearStamp): { start: DateStamp; end: DateStamp } {
  const start = parse(year, YEAR_FORMAT, new Date())
  return { start: toDateStamp(startOfYear(start)), end: toDateStamp(endOfYear(start)) }
}

/** Day `day` of `month`, clamped to the month's last day — "el 31" in
 *  February is the 28th/29th, never March 3rd. */
export function dayOfMonth(month: MonthStamp, day: number): DateStamp {
  const start = monthStart(month)
  const clamped = Math.min(Math.max(1, day), getDaysInMonth(start))
  return toDateStamp(new Date(start.getFullYear(), start.getMonth(), clamped))
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: DateStamp, to: DateStamp): number {
  return differenceInCalendarDays(fromDateStamp(to), fromDateStamp(from))
}

/** Whole months from `from` to `to` (negative if `to` is earlier). */
export function monthsBetween(from: MonthStamp, to: MonthStamp): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  const [ty, tm] = to.split('-').map(Number) as [number, number]
  return (ty - fy) * 12 + (tm - fm)
}

/** `date` moved `months` months, clamped to the month's last day (Jan 31 + 1
 *  = Feb 28) — the same rule installment due dates follow. */
export function addMonthsToDate(date: DateStamp, months: number): DateStamp {
  return toDateStamp(addMonths(fromDateStamp(date), months))
}

/** `date` moved `days` calendar days (negative goes back). */
export function addDays(date: DateStamp, days: number): DateStamp {
  return toDateStamp(addCalendarDays(fromDateStamp(date), days))
}

/** "hoy", "mañana", "en 5 días", "hace 3 días" — for a countdown to a date. */
export function relativeDays(days: number): string {
  if (days === 0) return 'hoy'
  if (days === 1) return 'mañana'
  if (days === -1) return 'ayer'
  return days > 0 ? `en ${days} días` : `hace ${-days} días`
}
