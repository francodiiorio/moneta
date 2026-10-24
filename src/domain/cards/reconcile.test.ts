import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import { statementDifferences } from './reconcile'

const ars = (n: number) => money(n, 'ARS')
const usd = (n: number) => money(n, 'USD')

describe('statementDifferences', () => {
  it('bank minus Moneta, per currency the bank shows', () => {
    expect(statementDifferences([ars(1000), usd(10)], [ars(1250), usd(10)])).toEqual([ars(250), usd(0)])
  })

  it('nothing to compare without bank totals', () => {
    expect(statementDifferences([ars(1000)], [])).toEqual([])
  })

  it('negative when the bank billed less', () => {
    expect(statementDifferences([ars(1000)], [ars(800)])).toEqual([ars(-200)])
  })

  it('a currency only the bank has is all difference; one only Moneta has is not compared', () => {
    expect(statementDifferences([ars(1000)], [usd(15)])).toEqual([usd(15)])
    expect(statementDifferences([ars(1000), usd(10)], [ars(1000)])).toEqual([ars(0)])
  })
})
