import { describe, expect, it } from 'vitest'
import { encodePaymentMethod, parsePaymentMethod, recurringPlanFormSchema } from './schema'

describe('payment method encoding', () => {
  it('round-trips card and none', () => {
    for (const method of [{ cardId: 'c1' }, {}]) {
      expect(parsePaymentMethod(encodePaymentMethod(method))).toEqual(method)
    }
  })

  it('reads an unknown or empty value as no payment method', () => {
    expect(parsePaymentMethod('bank:x')).toEqual({})
    // A debit account from before Etapa 10 reads as none.
    expect(parsePaymentMethod('account:a1')).toEqual({})
    expect(parsePaymentMethod('card:')).toEqual({})
    expect(parsePaymentMethod('')).toEqual({})
  })

  it('the form schema rejects a malformed value', () => {
    const base = {
      kind: 'expense' as const,
      description: 'x',
      categoryId: 'c',
      currency: 'ARS',
      amount: '1',
      freq: 'monthly' as const,
      interval: '1',
      startDate: '2026-01-01',
    }
    expect(recurringPlanFormSchema.safeParse({ ...base, paymentMethod: 'bank:x' }).success).toBe(false)
    expect(recurringPlanFormSchema.safeParse({ ...base, paymentMethod: 'account:a1' }).success).toBe(false)
    expect(recurringPlanFormSchema.safeParse({ ...base, paymentMethod: 'card:c1' }).success).toBe(true)
  })

  it('an ingreso fijo needs no account — and never goes with a card', () => {
    const base = { kind: 'income' as const, description: 'Sueldo', categoryId: 'c', currency: 'ARS', amount: '1', freq: 'monthly' as const, interval: '1', startDate: '2026-01-01' }
    expect(recurringPlanFormSchema.safeParse({ ...base, paymentMethod: '' }).success).toBe(true)
    expect(recurringPlanFormSchema.safeParse({ ...base, paymentMethod: 'card:c1' }).success).toBe(false)
  })
})
