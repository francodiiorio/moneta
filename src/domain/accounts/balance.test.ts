import { describe, expect, it } from 'vitest'
import type { AccountAdjustment, Expense, Income } from '@/domain/entities'
import { money } from '@/domain/money'
import {
  accountBalanceAt,
  adjustmentToReach,
  movementAccountProblem,
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
    })
    expect(movements.map((m) => m.amount.amount)).toEqual([50_000, -20_000, -150, 75])
  })

  it('skips expenses without an account (credit card / unspecified)', () => {
    const withoutAccount = expense()
    delete withoutAccount.accountId
    const movements = toAccountMovements({ incomes: [], expenses: [withoutAccount], adjustments: [] })
    expect(movements).toEqual([])
  })

  it('skips projected expenses — they have not happened yet', () => {
    const movements = toAccountMovements({
      incomes: [],
      expenses: [expense({ status: 'projected' })],
      adjustments: [],
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
