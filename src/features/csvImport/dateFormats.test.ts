import { describe, expect, it } from 'vitest'
import { parseDateColumn } from './dateFormats'

describe('parseDateColumn', () => {
  it('parses dd/MM/yyyy', () => {
    expect(parseDateColumn('23/08/2026', 'dd/MM/yyyy')).toBe('2026-08-23')
  })

  it('parses MM/dd/yyyy', () => {
    expect(parseDateColumn('08/23/2026', 'MM/dd/yyyy')).toBe('2026-08-23')
  })

  it('parses yyyy-MM-dd', () => {
    expect(parseDateColumn('2026-08-23', 'yyyy-MM-dd')).toBe('2026-08-23')
  })

  it('trims surrounding whitespace', () => {
    expect(parseDateColumn('  23/08/2026  ', 'dd/MM/yyyy')).toBe('2026-08-23')
  })

  it('returns undefined for garbage input', () => {
    expect(parseDateColumn('Saldo total', 'dd/MM/yyyy')).toBeUndefined()
  })

  it('returns undefined for an empty cell', () => {
    expect(parseDateColumn('', 'dd/MM/yyyy')).toBeUndefined()
  })

  it('returns undefined for an out-of-range calendar date', () => {
    expect(parseDateColumn('30/02/2026', 'dd/MM/yyyy')).toBeUndefined()
  })

  it('returns undefined when the format does not match the shape of the input', () => {
    expect(parseDateColumn('2026-08-23', 'dd/MM/yyyy')).toBeUndefined()
  })
})
