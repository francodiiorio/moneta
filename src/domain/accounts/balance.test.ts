import { describe, expect, it } from 'vitest'
import type { AccountAdjustment, Expense, Income, InvestmentLot, Transfer } from '@/domain/entities'
import { money } from '@/domain/money'
import {
  accountBalanceAt,
  adjustmentToReach,
  movementAccountProblem,
  transferImpliedRate,
  transferProblem,
  toAccountMovements,
  type AccountMovement,
  type BalanceAccount,
} from './balance'

const now = '2026-10-01T00:00:00.000Z'

const account: BalanceAccount = { id: 'a1', currency: 'ARS', openingBalance: 100_000, openingDate: '2026-10-01' }

function income(overrides: Partial<Income> = {}): Income {
  return {
    id: 'i1',
    date: '2026-10-05',
    amount: 50_000,
    currency: 'ARS',
    accountId: 'a1',
    categoryId: 'c-income',
    description: 'Sueldo',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    date: '2026-10-06',
    amount: 20_000,
    currency: 'ARS',
    categoryId: 'c-expense',
    description: 'Super',
    status: 'confirmed',
    accountId: 'a1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function adjustment(overrides: Partial<AccountAdjustment> = {}): AccountAdjustment {
  return {
    id: 'adj1',
    accountId: 'a1',
    date: '2026-10-07',
    amount: -150,
    currency: 'ARS',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function movement(date: string, amount: number, accountId = 'a1'): AccountMovement {
  return { accountId, date, amount: money(amount, 'ARS') }
}

describe('toAccountMovements', () => {
  it('signs incomes positive, debit expenses negative, adjustments as stored', () => {
    const movements = toAccountMovements({
      incomes: [income()],
      expenses: [expense()],
      adjustments: [adjustment({ amount: -150 }), adjustment({ id: 'adj2', amount: 75 })],
      transfers: [], investmentLots: [],
    })
    expect(movements.map((m) => m.amount.amount)).toEqual([50_000, -20_000, -150, 75])
  })

  it('skips expenses without an account (credit card / unspecified)', () => {
    const withoutAccount = expense()
    delete withoutAccount.accountId
    const movements = toAccountMovements({ incomes: [], expenses: [withoutAccount], adjustments: [], transfers: [], investmentLots: [] })
    expect(movements).toEqual([])
  })

  it('skips projected expenses — they have not happened yet', () => {
    const movements = toAccountMovements({
      incomes: [],
      expenses: [expense({ status: 'projected' })],
      adjustments: [],
      transfers: [], investmentLots: [],
    })
    expect(movements).toEqual([])
  })
})

describe('accountBalanceAt', () => {
  it('is the opening balance when nothing moved', () => {
    expect(accountBalanceAt(account, [], '2026-10-01')).toEqual(money(100_000, 'ARS'))
  })

  it('is undefined before the opening date — not a zero balance', () => {
    expect(accountBalanceAt(account, [], '2026-09-30')).toBeUndefined()
  })

  it('adds every movement up to and including the date', () => {
    const movements = [movement('2026-10-05', 50_000), movement('2026-10-06', -20_000), movement('2026-10-07', -150)]
    expect(accountBalanceAt(account, movements, '2026-10-06')).toEqual(money(130_000, 'ARS'))
    expect(accountBalanceAt(account, movements, '2026-10-07')).toEqual(money(129_850, 'ARS'))
  })

  it('counts a movement on the opening date itself', () => {
    expect(accountBalanceAt(account, [movement('2026-10-01', -1)], '2026-10-01')).toEqual(money(99_999, 'ARS'))
  })

  it('ignores movements of other accounts', () => {
    expect(accountBalanceAt(account, [movement('2026-10-05', 999, 'a2')], '2026-10-31')).toEqual(
      money(100_000, 'ARS'),
    )
  })

  it('ignores movements dated before the opening date (already in the opening balance)', () => {
    expect(accountBalanceAt(account, [movement('2026-09-30', 5_000)], '2026-10-31')).toEqual(
      money(100_000, 'ARS'),
    )
  })

  it('can go negative (overdraft)', () => {
    expect(accountBalanceAt(account, [movement('2026-10-02', -150_000)], '2026-10-02')).toEqual(
      money(-50_000, 'ARS'),
    )
  })

  it('rejects a movement in another currency instead of mixing them', () => {
    const usd: AccountMovement = { accountId: 'a1', date: '2026-10-02', amount: money(100, 'USD') }
    expect(() => accountBalanceAt(account, [usd], '2026-10-02')).toThrow()
  })
})

describe('adjustmentToReach', () => {
  it('is the signed difference from the computed balance to the real one', () => {
    expect(adjustmentToReach(money(129_850, 'ARS'), money(130_000, 'ARS'))).toEqual(money(150, 'ARS'))
    expect(adjustmentToReach(money(130_000, 'ARS'), money(129_850, 'ARS'))).toEqual(money(-150, 'ARS'))
  })

  it('is zero when they already match', () => {
    expect(adjustmentToReach(money(1, 'ARS'), money(1, 'ARS'))).toEqual(money(0, 'ARS'))
  })
})

describe('movementAccountProblem', () => {
  const target = { name: 'Galicia', currency: 'ARS', openingDate: '2026-10-01' }

  it('accepts a movement in the account currency on or after the opening date', () => {
    expect(movementAccountProblem(target, { date: '2026-10-01', currency: 'ARS' })).toBeUndefined()
  })

  it('rejects another currency', () => {
    expect(movementAccountProblem(target, { date: '2026-10-02', currency: 'USD' })).toMatch(/ARS/)
  })

  it('rejects a date before the opening date', () => {
    expect(movementAccountProblem(target, { date: '2026-09-30', currency: 'ARS' })).toMatch(/saldo inicial/)
  })
})

function transfer(overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: 't1',
    date: '2026-10-08',
    fromAccountId: 'a1',
    toAccountId: 'a2',
    fromAmount: 1_250_000_00,
    fromCurrency: 'ARS',
    toAmount: 1_000_00,
    toCurrency: 'USD',
    description: 'Compra de dólares',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('transfers', () => {
  it('a transfer is two movements: fromAmount leaves one account, toAmount enters the other', () => {
    const movements = toAccountMovements({ incomes: [], expenses: [], adjustments: [], transfers: [transfer()], investmentLots: [] })
    expect(movements).toEqual([
      { accountId: 'a1', date: '2026-10-08', amount: money(-1_250_000_00, 'ARS') },
      { accountId: 'a2', date: '2026-10-08', amount: money(1_000_00, 'USD') },
    ])
  })

  it('moves balance between accounts without creating or losing money in the same currency', () => {
    const a1: BalanceAccount = { id: 'a1', currency: 'ARS', openingBalance: 100_000, openingDate: '2026-10-01' }
    const a2: BalanceAccount = { id: 'a2', currency: 'ARS', openingBalance: 0, openingDate: '2026-10-01' }
    const movements = toAccountMovements({
      incomes: [],
      expenses: [],
      adjustments: [],
      transfers: [transfer({ fromAmount: 30_000, toAmount: 30_000, toCurrency: 'ARS' })],
      investmentLots: [],
    })
    expect(accountBalanceAt(a1, movements, '2026-10-31')).toEqual(money(70_000, 'ARS'))
    expect(accountBalanceAt(a2, movements, '2026-10-31')).toEqual(money(30_000, 'ARS'))
  })
})

describe('transferProblem', () => {
  const ars = { id: 'a1', name: 'Galicia', currency: 'ARS', openingDate: '2026-10-01' }
  const ars2 = { id: 'a3', name: 'Mercado Pago', currency: 'ARS', openingDate: '2026-10-01' }
  const usd = { id: 'a2', name: 'Caja USD', currency: 'USD', openingDate: '2026-10-05' }

  it('accepts a valid cross-currency transfer', () => {
    expect(transferProblem(transfer(), ars, usd)).toBeUndefined()
  })

  it('rejects the same account on both sides', () => {
    expect(transferProblem(transfer({ toAccountId: 'a1' }), ars, ars)).toMatch(/distintas/)
  })

  it('rejects a side whose currency does not match its account', () => {
    expect(transferProblem(transfer({ toCurrency: 'ARS' }), ars, usd)).toMatch(/Caja USD/)
  })

  it('rejects a date before either opening date', () => {
    expect(transferProblem(transfer({ date: '2026-10-03' }), ars, usd)).toMatch(/Caja USD/)
  })

  it('rejects different amounts between two accounts of the same currency', () => {
    const t = transfer({ toAccountId: 'a3', fromAmount: 100, toAmount: 99, toCurrency: 'ARS' })
    expect(transferProblem(t, ars, ars2)).toMatch(/iguales/)
    expect(transferProblem({ ...t, toAmount: 100 }, ars, ars2)).toBeUndefined()
  })

  it('rejects a non-positive amount', () => {
    expect(transferProblem(transfer({ toAmount: 0 }), ars, usd)).toMatch(/mayores a cero/)
  })
})

describe('transferImpliedRate', () => {
  it('reads as "1 USD = 1250 ARS" when buying dollars', () => {
    expect(transferImpliedRate(transfer())).toEqual({ base: 'USD', quote: 'ARS', rate: 1250 })
  })

  it('reads the same way when selling dollars', () => {
    const selling = transfer({ fromAmount: 1_000_00, fromCurrency: 'USD', toAmount: 1_200_000_00, toCurrency: 'ARS' })
    expect(transferImpliedRate(selling)).toEqual({ base: 'USD', quote: 'ARS', rate: 1200 })
  })
})

describe('investment purchases with a source account (Fase 3)', () => {
  function lot(overrides: Partial<InvestmentLot> = {}): InvestmentLot {
    return {
      id: 'l1',
      assetId: 'spy',
      quantity: 500_000_000,
      costPerUnit: 650_00,
      currency: 'USD',
      date: '2026-10-09',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    }
  }

  it('debits sourceAmount (in the account currency) on the purchase date', () => {
    const movements = toAccountMovements({
      incomes: [],
      expenses: [],
      adjustments: [],
      transfers: [],
      investmentLots: [lot({ sourceAccountId: 'a1', sourceAmount: 3_260_00, sourceCurrency: 'USD' })],
    })
    expect(movements).toEqual([{ accountId: 'a1', date: '2026-10-09', amount: money(-3_260_00, 'USD') }])
  })

  it('ignores a purchase without a source account', () => {
    const movements = toAccountMovements({ incomes: [], expenses: [], adjustments: [], transfers: [], investmentLots: [lot()] })
    expect(movements).toEqual([])
  })
})
