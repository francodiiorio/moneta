import { describe, expect, it } from 'vitest'
import { transferFormSchema } from './schema'

const BASE = {
  date: '2026-09-01',
  description: 'Pago tarjeta',
  fromAccountId: 'acc-1',
  toAccountId: 'acc-2',
  amount: '814.589,45',
}

describe('transferFormSchema', () => {
  it('accepts a same-currency transfer where toAmount is left at its empty default', () => {
    // Regression: the "Recibe" field is never rendered for a same-currency
    // transfer, so react-hook-form's controlled input keeps it at its
    // default '' — not undefined. `.optional()` alone only lets undefined
    // through, so this used to fail validation on every same-currency
    // transfer, silently (no FormMessage renders for a field that isn't
    // in the DOM) — Guardar just did nothing.
    const result = transferFormSchema.safeParse({ ...BASE, toAmount: '' })
    expect(result.success).toBe(true)
  })

  it('accepts toAmount entirely absent', () => {
    const result = transferFormSchema.safeParse(BASE)
    expect(result.success).toBe(true)
  })

  it('accepts a valid toAmount for a cross-currency transfer', () => {
    const result = transferFormSchema.safeParse({ ...BASE, toAmount: '650,00' })
    expect(result.success).toBe(true)
  })

  it('rejects a toAmount that is present but not a valid amount', () => {
    expect(transferFormSchema.safeParse({ ...BASE, toAmount: '0' }).success).toBe(false)
    expect(transferFormSchema.safeParse({ ...BASE, toAmount: '-5' }).success).toBe(false)
    expect(transferFormSchema.safeParse({ ...BASE, toAmount: 'abc' }).success).toBe(false)
  })

  it('rejects transferring an account to itself', () => {
    const result = transferFormSchema.safeParse({ ...BASE, toAccountId: BASE.fromAccountId })
    expect(result.success).toBe(false)
  })

  it('rejects a missing or zero amount', () => {
    expect(transferFormSchema.safeParse({ ...BASE, amount: '' }).success).toBe(false)
    expect(transferFormSchema.safeParse({ ...BASE, amount: '0' }).success).toBe(false)
  })
})
