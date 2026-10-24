import { describe, expect, it } from 'vitest'
import { encodePaymentMethod, parsePaymentMethod, recurringPlanFormSchema } from './schema'

describe('payment method encoding', () => {
  it('round-trips debit, card and none', () => {
    for (const method of [{ accountId: 'a1' }, { cardId: 'c1' }, {}]) {
      expect(parsePaymentMethod(encodePaymentMethod(method))).toEqual(method)
    }
  })

  it('reads an unknown or empty value as no payment method', () => {
    expect(parsePaymentMethod('bank:x')).toEqual({})
    expect(parsePaymentMethod('card:')).toEqual({})
    expect(parsePaymentMethod('')).toEqual({})
  })

  it('the form schema rejects a malformed value', () => {
    const base = {
      description: 'x',
      categoryId: 'c',
      currency: 'ARS',
      amount: '1',
      freq: 'monthly' as const,
      interval: '1',
      startDate: '2026-01-01',
    }
    expect(recurringPlanFormSchema.safeParse({ ...base, paymentMethod: 'bank:x' }).success).toBe(false)
    expect(recurringPlanFormSchema.safeParse({ ...base, paymentMethod: 'card:c1' }).success).toBe(true)
  })
})
