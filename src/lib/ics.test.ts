import { describe, expect, it } from 'vitest'
import { buildIcs } from './ics'

const NOW = new Date(Date.UTC(2026, 10, 2, 21, 5, 9))

function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n')
}

describe('buildIcs', () => {
  it('writes all-day events with CRLF line endings, a stable UID and the end the day after', () => {
    const ics = buildIcs([{ uid: 'card-due-1-2026-10', date: '2026-11-30', title: 'Vence Visa' }], NOW)
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/)
    const lines = unfold(ics)
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('UID:card-due-1-2026-10@moneta')
    expect(lines).toContain('DTSTAMP:20261102T210509Z')
    expect(lines).toContain(`SEQUENCE:${Math.floor(NOW.getTime() / 60_000)}`)
    expect(lines).toContain('DTSTART;VALUE=DATE:20261130')
    // Month and year rollovers.
    expect(lines).toContain('DTEND;VALUE=DATE:20261201')
    expect(buildIcs([{ uid: 'x', date: '2026-12-31', title: 'x' }], NOW)).toContain('DTEND;VALUE=DATE:20270101')
    expect(lines).toContain('SUMMARY:Vence Visa')
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1)
    expect(lines.at(-2)).toBe('END:VCALENDAR')
  })

  it('escapes text values', () => {
    const lines = unfold(buildIcs([{ uid: 'a', date: '2026-11-04', title: 'Luz, gas; agua\\', description: 'una\notra\rmás\u0007' }], NOW))
    expect(lines).toContain('SUMMARY:Luz\\, gas\\; agua\\\\')
    expect(lines).toContain('DESCRIPTION:una\\notra\\nmás')
  })

  it('reminds the day before at the given hour, or the same day', () => {
    const before = unfold(buildIcs([{ uid: 'a', date: '2026-11-04', title: 'a', reminder: { daysBefore: 1, hour: 10 } }], NOW))
    expect(before).toContain('BEGIN:VALARM')
    expect(before).toContain('ACTION:DISPLAY')
    // Midnight of the 4th minus 14 hours = the 3rd at 10:00.
    expect(before).toContain('TRIGGER:-PT840M')
    const sameDay = unfold(buildIcs([{ uid: 'a', date: '2026-11-04', title: 'a', reminder: { daysBefore: 0, hour: 9 } }], NOW))
    expect(sameDay).toContain('TRIGGER:PT540M')
    expect(unfold(buildIcs([{ uid: 'a', date: '2026-11-04', title: 'a' }], NOW))).not.toContain('BEGIN:VALARM')
  })

  it('folds lines at 75 octets without splitting a character', () => {
    const title = 'Cuota de la heladera con ñandú y acentos áéíóú '.repeat(4)
    const ics = buildIcs([{ uid: 'a', date: '2026-11-04', title }], NOW)
    const encoder = new TextEncoder()
    for (const line of ics.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
    expect(unfold(ics)).toContain(`SUMMARY:${title}`)
  })

  it('an empty list still parses (the UI never exports one)', () => {
    const lines = unfold(buildIcs([], NOW))
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).not.toContain('BEGIN:VEVENT')
  })
})
