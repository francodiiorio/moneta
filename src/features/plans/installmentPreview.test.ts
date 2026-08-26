import { describe, expect, it } from 'vitest'
import { formatMoney, money } from '@/domain/money'
import { getInstallmentPreview, MAX_PREVIEW_COUNT } from './installmentPreview'

describe('getInstallmentPreview', () => {
  it('shows a single amount when the total divides evenly', () => {
    expect(getInstallmentPreview('1200', '12', 'ARS')).toBe(`= ${formatMoney(money(100_00, 'ARS'))} por cuota`)
  })

  it('shows a range when allocate() cannot split evenly, never a silently-wrong single number', () => {
    // 100 / 3 = 33,33 + 33,33 + 33,34 (largest-remainder bump on one share).
    expect(getInstallmentPreview('100', '3', 'ARS')).toBe(
      `= ${formatMoney(money(33_33, 'ARS'))}–${formatMoney(money(33_34, 'ARS'))} por cuota`,
    )
  })

  it('returns undefined while the amount is still empty or has no digits', () => {
    expect(getInstallmentPreview('', '12', 'ARS')).toBeUndefined()
    expect(getInstallmentPreview('-', '12', 'ARS')).toBeUndefined()
  })

  it('returns undefined without a currency (no account chosen yet)', () => {
    expect(getInstallmentPreview('1200', '12', undefined)).toBeUndefined()
  })

  it('returns undefined for a non-positive or non-integer count', () => {
    expect(getInstallmentPreview('1200', '0', 'ARS')).toBeUndefined()
    expect(getInstallmentPreview('1200', '-3', 'ARS')).toBeUndefined()
    expect(getInstallmentPreview('1200', '2.5', 'ARS')).toBeUndefined()
    expect(getInstallmentPreview('1200', 'abc', 'ARS')).toBeUndefined()
  })

  it('returns undefined for a count beyond the sanity cap, instead of building a huge array', () => {
    expect(getInstallmentPreview('1200', String(MAX_PREVIEW_COUNT + 1), 'ARS')).toBeUndefined()
  })

  it('returns undefined for a zero or negative total amount', () => {
    expect(getInstallmentPreview('0', '12', 'ARS')).toBeUndefined()
  })

  it('respects the account currency for formatting', () => {
    expect(getInstallmentPreview('120', '12', 'USD')).toBe(`= ${formatMoney(money(10_00, 'USD'))} por cuota`)
  })
})
