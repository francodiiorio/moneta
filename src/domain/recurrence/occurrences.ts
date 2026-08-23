import { addDays, addMonths, addWeeks, addYears, getDaysInMonth, setDate } from 'date-fns'
import { fromDateStamp, toDateStamp, type DateStamp } from '@/lib/dates'
import type { RecurrenceRule } from '@/domain/entities'

/** Hard cap so a malformed rule (e.g. interval regression) can't hang the browser. */
const MAX_ITERATIONS = 10_000

function clampDayOfMonth(date: Date, dayOfMonth: number): Date {
  return setDate(date, Math.min(dayOfMonth, getDaysInMonth(date)))
}

function weeklyAnchor(startDate: Date, weekday: number): Date {
  const shift = (weekday - startDate.getDay() + 7) % 7
  return addDays(startDate, shift)
}

/**
 * The date-fns `addX` functions compute from the ORIGINAL date each call,
 * clamping to the end of a short month rather than rolling over (verified:
 * `addMonths(Jan 31, 1)` = Feb 28, `addMonths(Jan 31, 2)` = Mar 31 — not
 * Mar 3). Calling `addMonths(anchor, i * interval)` fresh from the same
 * `anchor` for every `i`, instead of repeatedly advancing the previous
 * result, is what keeps a `dayOfMonth: 31` rule anchored to the 31st
 * every month that has one, instead of drifting down to the 28th after
 * the first February.
 */
function occurrenceAt(rule: RecurrenceRule, index: number): Date {
  const start = fromDateStamp(rule.startDate)
  switch (rule.freq) {
    case 'daily':
      return addDays(start, index * rule.interval)
    case 'weekly': {
      const anchor = rule.weekday !== undefined ? weeklyAnchor(start, rule.weekday) : start
      return addWeeks(anchor, index * rule.interval)
    }
    case 'monthly': {
      const anchor = rule.dayOfMonth !== undefined ? clampDayOfMonth(start, rule.dayOfMonth) : start
      return addMonths(anchor, index * rule.interval)
    }
    case 'yearly': {
      const anchor = rule.dayOfMonth !== undefined ? clampDayOfMonth(start, rule.dayOfMonth) : start
      return addYears(anchor, index * rule.interval)
    }
  }
}

/** All occurrence dates of `rule` from its `startDate` through `through`
 *  (inclusive), respecting `endDate` and `maxOccurrences`. Returns `[]`
 *  if the rule hasn't started yet. */
export function generateOccurrences(rule: RecurrenceRule, through: DateStamp): DateStamp[] {
  const throughDate = fromDateStamp(through)
  const endDate = rule.endDate ? fromDateStamp(rule.endDate) : undefined
  const dates: DateStamp[] = []

  for (let index = 0; index < MAX_ITERATIONS; index++) {
    if (rule.maxOccurrences !== undefined && index >= rule.maxOccurrences) break
    const date = occurrenceAt(rule, index)
    if (date > throughDate) break
    if (endDate && date > endDate) break
    dates.push(toDateStamp(date))
  }

  return dates
}

/** First occurrence strictly after `after`, or `undefined` if the rule is
 *  exhausted (`endDate`/`maxOccurrences`) before reaching one. Used to
 *  show "próxima ocurrencia" in the UI — unlike `generateOccurrences`,
 *  this isn't bounded by a `through` date. */
export function nextOccurrenceAfter(rule: RecurrenceRule, after: DateStamp): DateStamp | undefined {
  const afterDate = fromDateStamp(after)
  const endDate = rule.endDate ? fromDateStamp(rule.endDate) : undefined

  for (let index = 0; index < MAX_ITERATIONS; index++) {
    if (rule.maxOccurrences !== undefined && index >= rule.maxOccurrences) return undefined
    const date = occurrenceAt(rule, index)
    if (endDate && date > endDate) return undefined
    if (date > afterDate) return toDateStamp(date)
  }
  return undefined
}

const FREQ_LABELS: Record<RecurrenceRule['freq'], { one: string; many: (n: number) => string }> = {
  daily: { one: 'Todos los días', many: (n) => `Cada ${n} días` },
  weekly: { one: 'Todas las semanas', many: (n) => `Cada ${n} semanas` },
  monthly: { one: 'Todos los meses', many: (n) => `Cada ${n} meses` },
  yearly: { one: 'Todos los años', many: (n) => `Cada ${n} años` },
}

/** Short Spanish description for the UI, e.g. "Todos los meses el día 5". */
export function describeRule(rule: RecurrenceRule): string {
  const { one, many } = FREQ_LABELS[rule.freq]
  const base = rule.interval === 1 ? one : many(rule.interval)
  if (rule.freq === 'monthly' && rule.dayOfMonth !== undefined) return `${base} el día ${rule.dayOfMonth}`
  return base
}
