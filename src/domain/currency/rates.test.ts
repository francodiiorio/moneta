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

describe('resolveRate — profile', () => {
  const profiledRates: ExchangeRate[] = [
    { id: '1', date: '2026-06-01', from: 'USD', to: 'ARS', rate: 1000, profile: 'oficial' },
    { id: '2', date: '2026-06-01', from: 'USD', to: 'ARS', rate: 1450, profile: 'mep' },
    { id: '3', date: '2026-06-01', from: 'USD', to: 'ARS', rate: 1300 }, // no profile — the wildcard
  ]

  it('prefers the requested profile when it exists', () => {
    expect(resolveRate(profiledRates, 'USD', 'ARS', '2026-06-01', 'mep')).toBe(1450)
    expect(resolveRate(profiledRates, 'USD', 'ARS', '2026-06-01', 'oficial')).toBe(1000)
  })

  it('falls back to a rate with no profile when the requested one has none', () => {
    expect(resolveRate(profiledRates, 'USD', 'ARS', '2026-06-01', 'blue')).toBe(1300)
  })

  it('with no profile requested, only considers rates with no profile set', () => {
    expect(resolveRate(profiledRates, 'USD', 'ARS', '2026-06-01')).toBe(1300)
  })
})

describe('resolveRate — triangulation through USD', () => {
  const triRates: ExchangeRate[] = [
    { id: '1', date: '2026-06-01', from: 'EUR', to: 'USD', rate: 1.1 },
    { id: '2', date: '2026-06-01', from: 'USD', to: 'ARS', rate: 1000 },
  ]

  it('triangulates when there is no direct or reciprocal rate for the pair', () => {
    expect(resolveRate(triRates, 'EUR', 'ARS', '2026-06-01')).toBeCloseTo(1.1 * 1000)
  })

  it('triangulates in the reverse direction too', () => {
    expect(resolveRate(triRates, 'ARS', 'EUR', '2026-06-01')).toBeCloseTo(1 / (1.1 * 1000))
  })

  it('does not triangulate when a direct rate already exists', () => {
    const withDirect: ExchangeRate[] = [...triRates, { id: '3', date: '2026-06-01', from: 'EUR', to: 'ARS', rate: 999 }]
    expect(resolveRate(withDirect, 'EUR', 'ARS', '2026-06-01')).toBe(999)
  })

  it('does not triangulate when one leg is missing', () => {
    const onlyOneLeg: ExchangeRate[] = [{ id: '1', date: '2026-06-01', from: 'EUR', to: 'USD', rate: 1.1 }]
    expect(resolveRate(onlyOneLeg, 'EUR', 'ARS', '2026-06-01')).toBeUndefined()
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
