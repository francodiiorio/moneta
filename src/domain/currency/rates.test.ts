import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import type { ExchangeRate } from '@/domain/entities'
import { convert, resolveRate } from './rates'

const rates: ExchangeRate[] = [
  { id: '1', date: '2026-01-01', from: 'USD', to: 'ARS', rate: 1000 },
  { id: '2', date: '2026-03-01', from: 'USD', to: 'ARS', rate: 1200 },
]

describe('resolveRate', () => {
  it('returns 1 for same currency', () => {
    expect(resolveRate(rates, 'ARS', 'ARS', '2026-01-01')).toBe(1)
  })

  it('picks the most recent rate on or before the date', () => {
    expect(resolveRate(rates, 'USD', 'ARS', '2026-02-15')).toBe(1000)
    expect(resolveRate(rates, 'USD', 'ARS', '2026-06-01')).toBe(1200)
  })

  it('returns undefined before any rate exists', () => {
    expect(resolveRate(rates, 'USD', 'ARS', '2025-12-31')).toBeUndefined()
  })

  it('falls back to the reciprocal of the inverse pair', () => {
    expect(resolveRate(rates, 'ARS', 'USD', '2026-01-01')).toBeCloseTo(1 / 1000)
  })

  it('returns undefined when no rate exists in either direction', () => {
    expect(resolveRate(rates, 'EUR', 'ARS', '2026-06-01')).toBeUndefined()
  })
})

describe('convert', () => {
  it('is a no-op for the same currency', () => {
    const amount = money(500, 'ARS')
    expect(convert(amount, 'ARS', rates, '2026-01-01')).toEqual(amount)
  })

  it('converts using the resolved rate', () => {
    const amount = money(10, 'USD')
    expect(convert(amount, 'ARS', rates, '2026-01-01')).toEqual(money(10_000, 'ARS'))
  })

  it('throws when no rate is available', () => {
    expect(() => convert(money(10, 'EUR'), 'ARS', rates, '2026-01-01')).toThrow(/No exchange rate/)
  })
})
