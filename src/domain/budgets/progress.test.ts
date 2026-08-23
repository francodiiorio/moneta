import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import type { Budget } from '@/domain/entities'
import { calculateBudgetProgress, resolveActiveBudget } from './progress'

function budget(id: string, startsOn: string, period: Budget['period'] = 'monthly', categoryId = 'food'): Budget {
  const now = new Date().toISOString()
  return {
    id,
    categoryId,
    currency: 'ARS',
    period,
    amount: 1000,
    startsOn,
    createdAt: now,
    updatedAt: now,
  }
}

describe('resolveActiveBudget', () => {
  it('picks the most recent startsOn on or before the evaluated month', () => {
    const budgets = [budget('a', '2026-01'), budget('b', '2026-06'), budget('c', '2026-09')]
    expect(resolveActiveBudget(budgets, 'food', 'monthly', '2026-08')?.id).toBe('b')
  })

  it('ignores a budget that only starts in the future relative to the evaluated month', () => {
    const budgets = [budget('a', '2026-01'), budget('future', '2027-01')]
    expect(resolveActiveBudget(budgets, 'food', 'monthly', '2026-08')?.id).toBe('a')
  })

  it('returns undefined when no version is in effect yet', () => {
    const budgets = [budget('future', '2027-01')]
    expect(resolveActiveBudget(budgets, 'food', 'monthly', '2026-08')).toBeUndefined()
  })

  it('does not mix different categories or periods', () => {
    const budgets = [
      budget('food-monthly', '2026-01', 'monthly', 'food'),
      budget('food-yearly', '2026-01', 'yearly', 'food'),
      budget('transport-monthly', '2026-01', 'monthly', 'transport'),
    ]
    expect(resolveActiveBudget(budgets, 'food', 'monthly', '2026-08')?.id).toBe('food-monthly')
    expect(resolveActiveBudget(budgets, 'food', 'yearly', '2026-08')?.id).toBe('food-yearly')
    expect(resolveActiveBudget(budgets, 'transport', 'monthly', '2026-08')?.id).toBe('transport-monthly')
  })

  it('treats startsOn equal to the evaluated month as already in effect', () => {
    const budgets = [budget('a', '2026-08')]
    expect(resolveActiveBudget(budgets, 'food', 'monthly', '2026-08')?.id).toBe('a')
  })

  it('breaks a startsOn tie by id (most recently created), not array order', () => {
    const budgets = [budget('b-newer', '2026-01'), budget('a-older', '2026-01')]
    expect(resolveActiveBudget(budgets, 'food', 'monthly', '2026-08')?.id).toBe('b-newer')
  })
})

describe('calculateBudgetProgress', () => {
  it('computes remaining and percentUsed for a normal case', () => {
    const progress = calculateBudgetProgress(money(1000, 'ARS'), money(400, 'ARS'))
    expect(progress.remaining).toEqual(money(600, 'ARS'))
    expect(progress.percentUsed).toBe(40)
    expect(progress.isOverBudget).toBe(false)
  })

  it('flags exactly-at-limit as not over budget', () => {
    const progress = calculateBudgetProgress(money(1000, 'ARS'), money(1000, 'ARS'))
    expect(progress.percentUsed).toBe(100)
    expect(progress.isOverBudget).toBe(false)
    expect(progress.remaining).toEqual(money(0, 'ARS'))
  })

  it('flags over-limit with a negative remaining and percentUsed > 100', () => {
    const progress = calculateBudgetProgress(money(1000, 'ARS'), money(1500, 'ARS'))
    expect(progress.percentUsed).toBe(150)
    expect(progress.isOverBudget).toBe(true)
    expect(progress.remaining).toEqual(money(-500, 'ARS'))
  })

  it('handles a zero budget without dividing by zero', () => {
    const spent = calculateBudgetProgress(money(0, 'ARS'), money(500, 'ARS'))
    expect(spent.percentUsed).toBe(100)
    expect(spent.isOverBudget).toBe(true)

    const untouched = calculateBudgetProgress(money(0, 'ARS'), money(0, 'ARS'))
    expect(untouched.percentUsed).toBe(0)
    expect(untouched.isOverBudget).toBe(false)
  })

  it('rejects comparing across currencies', () => {
    expect(() => calculateBudgetProgress(money(1000, 'ARS'), money(10, 'USD'))).toThrow(/currencies/)
  })
})
