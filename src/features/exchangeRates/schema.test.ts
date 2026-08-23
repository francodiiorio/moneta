import { describe, expect, it } from 'vitest'
import { exchangeRateFormSchema, rateValueToNumber } from './schema'

describe('rateValueToNumber', () => {
  it('parses the exact placeholder the form suggests ("1.200,00")', () => {
    expect(rateValueToNumber('1.200,00')).toBe(1200)
  })

  it('parses a plain integer and a dot-decimal (en-US style)', () => {
    expect(rateValueToNumber('1200')).toBe(1200)
    expect(rateValueToNumber('1,200.50')).toBe(1200.5)
  })

  it('parses a comma-decimal without thousands separator', () => {
    expect(rateValueToNumber('1,5')).toBe(1.5)
  })
})

describe('exchangeRateFormSchema', () => {
  const base = { date: '2026-08-01', from: 'USD', to: 'ARS' }

  it('accepts the placeholder-formatted rate', () => {
    const result = exchangeRateFormSchema.safeParse({ ...base, rate: '1.200,00' })
    expect(result.success).toBe(true)
  })

  it('rejects a zero or negative rate', () => {
    expect(exchangeRateFormSchema.safeParse({ ...base, rate: '0' }).success).toBe(false)
    expect(exchangeRateFormSchema.safeParse({ ...base, rate: '-5' }).success).toBe(false)
  })

  it('rejects the same currency on both sides', () => {
    const result = exchangeRateFormSchema.safeParse({ ...base, to: 'USD', rate: '1200' })
    expect(result.success).toBe(false)
  })
})
