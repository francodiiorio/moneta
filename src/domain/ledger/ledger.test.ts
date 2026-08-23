import { describe, expect, it } from 'vitest'
import { minor, money } from '@/domain/money'
import { buildExpense, buildFxTransfer, buildIncome, buildTransfer } from './builders'
import { validateLedgerEntry } from './invariants'
import { calculateAccountBalance } from './balance'

const accountCurrencies = new Map([
  ['bank-ars', 'ARS'],
  ['cash-ars', 'ARS'],
  ['bank-usd', 'USD'],
])

describe('buildExpense', () => {
  it('debits the account and credits the category by the same amount', () => {
    const entry = buildExpense({
      date: '2026-08-23',
      description: 'Supermercado',
      accountId: 'bank-ars',
      categoryId: 'food',
      amount: money(1050, 'ARS'),
    })
    expect(entry.kind).toBe('expense')
    expect(entry.postings).toEqual([
      { target: 'account', accountId: 'bank-ars', amount: -1050, currency: 'ARS' },
      { target: 'category', categoryId: 'food', amount: 1050, currency: 'ARS' },
    ])
    expect(() => validateLedgerEntry(entry, accountCurrencies)).not.toThrow()
  })
})

describe('buildIncome', () => {
  it('credits the account and debits the category', () => {
    const entry = buildIncome({
      date: '2026-08-23',
      description: 'Sueldo',
      accountId: 'bank-ars',
      categoryId: 'salary',
      amount: money(500_000, 'ARS'),
    })
    expect(entry.kind).toBe('income')
    expect(entry.postings).toEqual([
      { target: 'account', accountId: 'bank-ars', amount: 500_000, currency: 'ARS' },
      { target: 'category', categoryId: 'salary', amount: -500_000, currency: 'ARS' },
    ])
    expect(() => validateLedgerEntry(entry, accountCurrencies)).not.toThrow()
  })
})

describe('buildTransfer', () => {
  it('moves money between two accounts in the same currency', () => {
    const entry = buildTransfer({
      date: '2026-08-23',
      description: 'Ahorro',
      fromAccountId: 'bank-ars',
      toAccountId: 'cash-ars',
      amount: money(2000, 'ARS'),
    })
    expect(entry.postings).toEqual([
      { target: 'account', accountId: 'bank-ars', amount: -2000, currency: 'ARS' },
      { target: 'account', accountId: 'cash-ars', amount: 2000, currency: 'ARS' },
    ])
    expect(() => validateLedgerEntry(entry, accountCurrencies)).not.toThrow()
  })
})

describe('buildFxTransfer', () => {
  it('records both legs and the rate used', () => {
    const entry = buildFxTransfer({
      date: '2026-08-23',
      description: 'Compra de dólares',
      fromAccountId: 'bank-ars',
      toAccountId: 'bank-usd',
      fromAmount: money(120_000, 'ARS'),
      toAmount: money(100, 'USD'),
      rate: 100 / 120_000,
    })
    expect(entry.fx).toEqual({ rate: 100 / 120_000, from: 'ARS', to: 'USD' })
    expect(() => validateLedgerEntry(entry, accountCurrencies)).not.toThrow()
  })

  it('rejects an fx transfer whose legs do not match the stated rate', () => {
    const entry = buildFxTransfer({
      date: '2026-08-23',
      description: 'Compra de dólares mal calculada',
      fromAccountId: 'bank-ars',
      toAccountId: 'bank-usd',
      fromAmount: money(120_000, 'ARS'),
      toAmount: money(500, 'USD'), // way off from what the rate implies
      rate: 100 / 120_000,
    })
    expect(() => validateLedgerEntry(entry, accountCurrencies)).toThrow(/don't balance/)
  })
})

describe('validateLedgerEntry', () => {
  it('rejects fewer than 2 postings', () => {
    const entry = buildExpense({
      date: '2026-08-23',
      description: 'x',
      accountId: 'bank-ars',
      categoryId: 'food',
      amount: money(100, 'ARS'),
    })
    entry.postings = [entry.postings[0]!]
    expect(() => validateLedgerEntry(entry, accountCurrencies)).toThrow(/at least 2/)
  })

  it('rejects an account posting whose currency mismatches the account', () => {
    const entry = buildExpense({
      date: '2026-08-23',
      description: 'x',
      accountId: 'bank-usd', // USD account
      categoryId: 'food',
      amount: money(100, 'ARS'), // ARS posting — mismatch
    })
    expect(() => validateLedgerEntry(entry, accountCurrencies)).toThrow(
      /doesn't match account currency/,
    )
  })

  it('rejects an unbalanced mono-currency transaction', () => {
    const entry = buildExpense({
      date: '2026-08-23',
      description: 'x',
      accountId: 'bank-ars',
      categoryId: 'food',
      amount: money(100, 'ARS'),
    })
    entry.postings[1]!.amount = minor(99)
    expect(() => validateLedgerEntry(entry, accountCurrencies)).toThrow(/sum to zero/)
  })

  it('rejects a posting missing its target id', () => {
    const entry = buildExpense({
      date: '2026-08-23',
      description: 'x',
      accountId: 'bank-ars',
      categoryId: 'food',
      amount: money(100, 'ARS'),
    })
    delete entry.postings[0]!.accountId
    expect(() => validateLedgerEntry(entry, accountCurrencies)).toThrow(/must set accountId/)
  })

  it('rejects an unknown account', () => {
    const entry = buildExpense({
      date: '2026-08-23',
      description: 'x',
      accountId: 'does-not-exist',
      categoryId: 'food',
      amount: money(100, 'ARS'),
    })
    expect(() => validateLedgerEntry(entry, accountCurrencies)).toThrow(/Unknown account/)
  })
})

describe('calculateAccountBalance', () => {
  it('adds confirmed posting amounts to the opening balance', () => {
    expect(calculateAccountBalance(minor(1000), [minor(-200), minor(500), minor(-50)])).toBe(1250)
  })

  it('returns the opening balance when there are no postings', () => {
    expect(calculateAccountBalance(minor(1000), [])).toBe(1000)
  })
})
