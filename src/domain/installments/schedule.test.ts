import { describe, expect, it } from 'vitest'
import { minor } from '@/domain/money'
import type { InstallmentPlan } from '@/domain/entities'
import { buildInstallmentSchedule, installmentAmounts, installmentDueDates } from './schedule'

describe('installmentAmounts', () => {
  it('sums exactly to the total even when it does not divide evenly', () => {
    const amounts = installmentAmounts(minor(10_000), 3)
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(10_000)
    expect(amounts).toEqual([minor(3_334), minor(3_333), minor(3_333)])
  })

  it('splits evenly when it divides exactly', () => {
    expect(installmentAmounts(minor(9_000), 3)).toEqual([minor(3_000), minor(3_000), minor(3_000)])
  })
})

describe('installmentDueDates', () => {
  it('generates one date per month from the anchor, without drifting after a short month', () => {
    const dates = installmentDueDates('2026-01-31', 4)
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
})

describe('buildInstallmentSchedule', () => {
  it('zips scheduleCache with due dates', () => {
    const plan: InstallmentPlan = {
      id: 'p1',
      description: 'Notebook',
      accountId: 'acc1',
      categoryId: 'cat1',
      totalAmount: 10_000,
      currency: 'ARS',
      count: 3,
      firstDueDate: '2026-01-05',
      purchaseDate: '2026-01-01',
      scheduleCache: [3_334, 3_333, 3_333],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    expect(buildInstallmentSchedule(plan)).toEqual([
      { index: 0, dueDate: '2026-01-05', amount: 3_334 },
      { index: 1, dueDate: '2026-02-05', amount: 3_333 },
      { index: 2, dueDate: '2026-03-05', amount: 3_333 },
    ])
  })
})
