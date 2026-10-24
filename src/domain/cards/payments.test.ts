import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import {
  statementPaymentDateProblem,
  statementPaymentLinesProblem,
  statementPaymentProblem,
  statementPaymentState,
} from './payments'

const ars = (n: number) => money(n, 'ARS')
const usd = (n: number) => money(n, 'USD')

describe('statementPaymentState', () => {
  it('unpaid without payments: what is owed is the totals', () => {
    expect(statementPaymentState([ars(1000), usd(10)], [])).toEqual({ status: 'unpaid', differences: [ars(1000), usd(10)] })
  })

  it('paid when every currency is paid by its exact total', () => {
    const payments = [
      { currency: 'ARS', amount: 1000 },
      { currency: 'USD', amount: 10 },
    ]
    expect(statementPaymentState([ars(1000), usd(10)], payments)).toEqual({ status: 'paid', differences: [] })
  })

  it('mismatch when the total grew after paying (still owes the difference)', () => {
    expect(statementPaymentState([ars(1200)], [{ currency: 'ARS', amount: 1000 }])).toEqual({
      status: 'mismatch',
      differences: [ars(200)],
    })
  })

  it('mismatch when only one of the currencies was paid', () => {
    expect(statementPaymentState([ars(1000), usd(10)], [{ currency: 'ARS', amount: 1000 }])).toEqual({
      status: 'mismatch',
      differences: [usd(10)],
    })
  })

  it('a payment in a currency the statement no longer has shows as overpaid (negative)', () => {
    expect(statementPaymentState([ars(1000)], [{ currency: 'ARS', amount: 1000 }, { currency: 'USD', amount: 5 }])).toEqual({
      status: 'mismatch',
      differences: [usd(-5)],
    })
  })
})

describe('statementPaymentProblem', () => {
  const galicia = { name: 'Galicia', currency: 'ARS', openingDate: '2026-01-01' }
  const base = { currency: 'ARS', amount: 1000, debitedAmount: 1000, debitedCurrency: 'ARS', date: '2026-11-05' }

  it('accepts a same-currency payment of exactly the amount', () => {
    expect(statementPaymentProblem(base, galicia)).toBeUndefined()
  })

  it('accepts paying dollars from a peso account with both real amounts', () => {
    expect(statementPaymentProblem({ ...base, currency: 'USD', amount: 10_00, debitedAmount: 12_500_00 }, galicia)).toBeUndefined()
  })

  it('rejects a debit in another currency than the account', () => {
    expect(statementPaymentProblem({ ...base, debitedCurrency: 'USD' }, galicia)).toMatch(/es en ARS/)
  })

  it('rejects a same-currency payment debiting a different amount', () => {
    expect(statementPaymentProblem({ ...base, debitedAmount: 999 }, galicia)).toMatch(/misma moneda/)
  })

  it('rejects a date before the account opening date, and non-positive amounts', () => {
    expect(statementPaymentProblem({ ...base, date: '2025-12-31' }, galicia)).toMatch(/saldo inicial/)
    expect(statementPaymentProblem({ ...base, amount: 0 }, galicia)).toMatch(/mayores a cero/)
  })
})

describe('statementPaymentLinesProblem', () => {
  const totals = [ars(1000), usd(10)]

  it('accepts one line per currency, each by the total shown', () => {
    const lines = [
      { currency: 'USD', expectedAmount: 10 },
      { currency: 'ARS', expectedAmount: 1000 },
    ]
    expect(statementPaymentLinesProblem(totals, lines)).toBeUndefined()
  })

  it('an empty statement has nothing to pay', () => {
    expect(statementPaymentLinesProblem([], [])).toMatch(/no tiene gastos/)
  })

  it('every currency, once: missing, repeated or foreign currencies are rejected', () => {
    expect(statementPaymentLinesProblem(totals, [{ currency: 'ARS', expectedAmount: 1000 }])).toMatch(/completo/)
    const repeated = [
      { currency: 'ARS', expectedAmount: 1000 },
      { currency: 'ARS', expectedAmount: 1000 },
    ]
    expect(statementPaymentLinesProblem([ars(1000)], repeated)).toMatch(/completo/)
    expect(statementPaymentLinesProblem([ars(1000)], [{ currency: 'EUR', expectedAmount: 1000 }])).toMatch(/completo/)
  })

  it('rejects when a total changed since it was shown', () => {
    const lines = [
      { currency: 'ARS', expectedAmount: 900 },
      { currency: 'USD', expectedAmount: 10 },
    ]
    expect(statementPaymentLinesProblem(totals, lines)).toMatch(/cambió/)
  })
})

describe('statementPaymentDateProblem', () => {
  it('a statement is paid on or after its close, never before', () => {
    expect(statementPaymentDateProblem('2026-10-25', '2026-10-25')).toBeUndefined()
    expect(statementPaymentDateProblem('2026-11-05', '2026-10-25')).toBeUndefined()
    expect(statementPaymentDateProblem('2026-10-24', '2026-10-25')).toMatch(/anterior al cierre/)
    expect(statementPaymentDateProblem('2026-02-31', '2026-01-25')).toMatch(/inválida/)
  })
})
