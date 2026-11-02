import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import { monthLeft } from './monthLeft'

const ars = (amount: number) => money(amount, 'ARS')

describe('monthLeft', () => {
  it('ingresos minus fixed, the cards due and everything else', () => {
    expect(monthLeft({ income: ars(1_500_000_00), fixed: ars(295_421_51), cards: ars(1_466_919_79), other: ars(12_000_00) })).toEqual(
      ars(-274_341_30),
    )
    expect(monthLeft({ income: ars(2_000_000_00), fixed: ars(300_000_00), cards: ars(900_000_00), other: ars(0) })).toEqual(ars(800_000_00))
  })

  it('with nothing in or out, nothing left', () => {
    expect(monthLeft({ income: ars(0), fixed: ars(0), cards: ars(0), other: ars(0) })).toEqual(ars(0))
  })

  it('never mixes currencies', () => {
    expect(() => monthLeft({ income: ars(1), fixed: money(1, 'USD'), cards: ars(0), other: ars(0) })).toThrow(/currencies/)
  })
})
