import { addDays, type DateStamp } from './dates'

/** An all-day calendar event (RFC 5545), with an optional reminder. */
export interface CalendarEvent {
  /** Stable across exports, so importing again updates instead of adding
   *  a copy (where the calendar app honors it). */
  uid: string
  date: DateStamp
  title: string
  description?: string
  /** `daysBefore` the event, at `hour` (local time). */
  reminder?: { daysBefore: number; hour: number }
}

const encoder = new TextEncoder()

function escapeText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
      // TEXT admits no other control characters (a PDF import can bring some).
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  )
}

/** RFC 5545 §3.1: lines longer than 75 octets continue on the next one,
 *  which starts with a space — cut between characters, never inside one. */
function fold(line: string): string {
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    // Continuation lines spend one octet on the leading space.
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const dateValue = (date: DateStamp) => date.replace(/-/g, '')

function utcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** All-day events start at local midnight: a reminder `daysBefore` at
 *  `hour` is that many minutes before (negative) or after it. */
function trigger({ daysBefore, hour }: { daysBefore: number; hour: number }): string {
  const minutes = daysBefore * 24 * 60 - hour * 60
  return minutes > 0 ? `-PT${minutes}M` : `PT${-minutes}M`
}

/** A calendar file with `events`, ready to download as `.ics`. RFC 5545
 *  wants at least one event: callers check there's something to export. */
export function buildIcs(events: readonly CalendarEvent[], now: Date = new Date()): string {
  const stamp = utcStamp(now)
  // A later export is a newer version of the same events (same UID):
  // without a higher SEQUENCE a calendar may keep the old one.
  const sequence = Math.floor(now.getTime() / 60_000)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moneta//Vencimientos//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@moneta`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
      `SEQUENCE:${sequence}`,
      `DTSTART;VALUE=DATE:${dateValue(event.date)}`,
      `DTEND;VALUE=DATE:${dateValue(addDays(event.date, 1))}`,
      `SUMMARY:${escapeText(event.title)}`,
      ...(event.description !== undefined ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
      'TRANSP:TRANSPARENT',
    )
    if (event.reminder) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(event.title)}`, `TRIGGER:${trigger(event.reminder)}`, 'END:VALARM')
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
