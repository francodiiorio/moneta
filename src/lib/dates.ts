import { format, parse, startOfMonth } from 'date-fns'

/** A calendar day with no timezone attached, e.g. "2026-08-23". */
export type DateStamp = string

/** A calendar month, e.g. "2026-08". */
export type MonthStamp = string

const DATE_FORMAT = 'yyyy-MM-dd'
const MONTH_FORMAT = 'yyyy-MM'

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
  return toDateStamp(fromDateStamp(value)) === value
}
