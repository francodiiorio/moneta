import { describe, expect, it } from 'vitest'
import type { ExchangeRate } from '@/domain/entities'
import { money } from '@/domain/money'
import { spendingTotals, type SpendingItem } from './spending'

const ars = (amount: number) => money(amount, 'ARS')
const item = (amount: number, status: SpendingItem['status'] = 'confirmed', currency = 'ARS', date = '2026-11-10'): SpendingItem => ({
  amount: money(amount, currency),
  status,
  date,
})
const rates: ExchangeRate[] = [{ id: 'r1', date: '2026-11-01', from: 'USD', to: 'ARS', rate: 1450 }]

describe('spendingTotals', () => {
  it('adds up what was spent and, apart, what is still to pay', () => {
    const totals = spendingTotals([item(100_00), item(250_50), item(73_950_81, 'projected'), item(4_571_66, 'projected')], 'ARS', [])
    expect(totals).toEqual({ spent: ars(350_50), pending: ars(78_522_47), missingRateCount: 0 })
  })

  it('converts each gasto at its own date', () => {
    const totals = spendingTotals([item(10_00, 'confirmed', 'USD'), item(500_00)], 'ARS', rates)
    expect(totals.spent).toEqual(ars(10_00 * 1450 + 500_00))
  })

  it('leaves out — and counts — a gasto with no rate, never assuming 1:1', () => {
    const totals = spendingTotals([item(10_00, 'confirmed', 'EUR'), item(5_00, 'projected', 'USD', '2026-10-31'), item(500_00)], 'ARS', rates)
    expect(totals).toEqual({ spent: ars(500_00), pending: ars(0), missingRateCount: 2 })
  })

  it('nothing loaded, nothing spent', () => {
    expect(spendingTotals([], 'ARS', [])).toEqual({ spent: ars(0), pending: ars(0), missingRateCount: 0 })
  })
})
