import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import { groupSpending, spendingObservations, type SpendingEntry, type SpendingPair } from './observations'

const ars = (amount: number) => money(amount, 'ARS')
const merchant = (label: string, previous: number, current: number): SpendingPair => ({
  kind: 'merchant',
  key: label.toLowerCase(),
  label,
  previous: ars(previous),
  current: ars(current),
})
const category = (label: string, previous: number, current: number, soleMerchant?: string): SpendingPair => ({
  ...merchant(label, previous, current),
  kind: 'category',
  ...(soleMerchant !== undefined && { soleMerchant }),
})

describe('spendingObservations', () => {
  it('says how much more or less, largest change in money first', () => {
    const result = spendingObservations(
      [merchant('Rappi', 100_000_00, 140_000_00), merchant('Uber', 80_000_00, 40_000_00), merchant('Coto', 200_000_00, 300_000_00)],
      ars(500_000_00),
    )
    expect(result.map((o) => [o.label, o.percent])).toEqual([
      ['Coto', 50],
      ['Rappi', 40],
      ['Uber', -50],
    ])
  })

  it('at most `limit`', () => {
    const pairs = ['A', 'B', 'C', 'D'].map((label, i) => merchant(label, 100_000_00, 200_000_00 + i * 10_000_00))
    expect(spendingObservations(pairs, ars(1_000_000_00)).map((o) => o.label)).toEqual(['D', 'C', 'B'])
    expect(spendingObservations(pairs, ars(1_000_000_00), 1)).toHaveLength(1)
  })

  it('leaves out a small change in percent — 25% is the floor', () => {
    const result = spendingObservations([merchant('Justo', 100_000_00, 125_000_00), merchant('Casi', 100_000_00, 124_999_99)], ars(100_000_00))
    expect(result.map((o) => o.label)).toEqual(['Justo'])
  })

  it('leaves out a change small against everything spent — 5% is the floor', () => {
    // 5% of 1.000.000 is 50.000: a kiosk doubling from 10.000 isn't news.
    const result = spendingObservations(
      [merchant('Kiosco', 10_000_00, 20_000_00), merchant('Justo', 50_000_00, 100_000_00), merchant('Casi', 50_000_00, 99_999_99)],
      ars(1_000_000_00),
    )
    expect(result.map((o) => o.label)).toEqual(['Justo'])
  })

  it('only what was spent in both periods: no percent from or to nothing', () => {
    const result = spendingObservations([merchant('Nuevo', 0, 500_000_00), merchant('Dejado', 500_000_00, 0)], ars(1_000_000_00))
    expect(result).toEqual([])
  })

  it('nothing to compare against, nothing to say', () => {
    expect(spendingObservations([merchant('Rappi', 100_00, 900_00)], ars(0))).toEqual([])
  })

  it('a category that is just one merchant says it once, as the merchant', () => {
    const result = spendingObservations(
      [category('Comida', 100_000_00, 180_000_00, 'rappi'), merchant('Rappi', 100_000_00, 180_000_00), category('Ropa', 60_000_00, 120_000_00)],
      ars(500_000_00),
    )
    expect(result.map((o) => [o.kind, o.label])).toEqual([
      ['merchant', 'Rappi'],
      ['category', 'Ropa'],
    ])
  })

  it('two merchants with the same amounts are two things to say', () => {
    const result = spendingObservations([merchant('Gimnasio', 100_000_00, 150_000_00), merchant('Club', 100_000_00, 150_000_00)], ars(500_000_00))
    expect(result.map((o) => o.label)).toEqual(['Club', 'Gimnasio'])
  })

  it('a repeat left out makes room for the next one', () => {
    const result = spendingObservations(
      [
        merchant('Rappi', 100_000_00, 300_000_00),
        category('Comida', 100_000_00, 300_000_00, 'rappi'),
        merchant('Zara', 100_000_00, 200_000_00),
        merchant('Uber', 100_000_00, 160_000_00),
      ],
      ars(500_000_00),
    )
    expect(result.map((o) => o.label)).toEqual(['Rappi', 'Zara', 'Uber'])
  })

  it('a category with more than that merchant still shows', () => {
    const result = spendingObservations([merchant('Rappi', 100_000_00, 180_000_00), category('Comida', 150_000_00, 260_000_00)], ars(500_000_00))
    expect(result.map((o) => o.label)).toEqual(['Comida', 'Rappi'])
  })

  it('leaves out what could not be fully converted', () => {
    expect(spendingObservations([{ ...merchant('Viaje', 100_000_00, 220_000_00), partial: true }], ars(500_000_00))).toEqual([])
  })

  it('never mixes currencies', () => {
    expect(() => spendingObservations([{ ...merchant('Rappi', 100, 200), current: money(200, 'USD') }], ars(100))).toThrow(/currencies/)
  })
})

describe('groupSpending', () => {
  const entry = (period: SpendingEntry['period'], date: string, description: string, amount: number | undefined, category?: string): SpendingEntry => ({
    period,
    date,
    description,
    amount: amount === undefined ? undefined : ars(amount),
    ...(category !== undefined && { category: { id: category.toLowerCase(), name: category } }),
  })
  const byKey = (pairs: SpendingPair[]) => Object.fromEntries(pairs.map((p) => [p.key, p]))

  it('totals each merchant and category per period, and the previous total', () => {
    const { pairs, previousTotal } = groupSpending(
      [
        entry('previous', '2026-10-02', 'Rappi', 100_00, 'Comida'),
        entry('previous', '2026-10-03', 'Coto', 300_00, 'Comida'),
        entry('current', '2026-11-02', 'Rappi', 250_00, 'Comida'),
      ],
      'ARS',
    )
    const groups = byKey(pairs)
    expect(groups['merchant:rappi']).toMatchObject({ kind: 'merchant', label: 'Rappi', previous: ars(100_00), current: ars(250_00) })
    expect(groups['merchant:coto']).toMatchObject({ previous: ars(300_00), current: ars(0) })
    expect(groups['category:comida']).toMatchObject({ kind: 'category', label: 'Comida', previous: ars(400_00), current: ars(250_00) })
    expect(groups['category:comida']).not.toHaveProperty('soleMerchant')
    expect(previousTotal).toEqual(ars(400_00))
  })

  it('one merchant however it was written, named as it was written last', () => {
    const { pairs } = groupSpending(
      [entry('current', '2026-11-05', 'Café  Martínez ', 100_00), entry('previous', '2026-10-01', 'CAFE MARTINEZ', 100_00), entry('current', '2026-11-01', 'cafe martinez', 100_00)],
      'ARS',
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ label: 'Café Martínez', previous: ars(100_00), current: ars(200_00) })
  })

  it('marks a category that is a single merchant', () => {
    const { pairs } = groupSpending([entry('previous', '2026-10-01', 'Zara', 100_00, 'Ropa'), entry('current', '2026-11-01', 'ZARA', 50_00, 'Ropa')], 'ARS')
    expect(byKey(pairs)['category:ropa']?.soleMerchant).toBe('merchant:zara')
  })

  it('a gasto that could not be converted makes its groups partial, and is out of the total', () => {
    const { pairs, previousTotal } = groupSpending(
      [entry('previous', '2026-10-01', 'Viaje', undefined, 'Viajes'), entry('previous', '2026-10-02', 'Coto', 100_00, 'Comida'), entry('current', '2026-11-01', 'Viaje', 200_00, 'Viajes')],
      'ARS',
    )
    const groups = byKey(pairs)
    expect(groups['merchant:viaje']?.partial).toBe(true)
    expect(groups['category:viajes']?.partial).toBe(true)
    expect(groups['merchant:coto']).not.toHaveProperty('partial')
    expect(previousTotal).toEqual(ars(100_00))
  })

  it('without a category (deleted) it still counts for its merchant and the total; a blank description, for the total only', () => {
    const { pairs, previousTotal } = groupSpending([entry('previous', '2026-10-01', 'Rappi', 100_00), entry('previous', '2026-10-02', '  ', 50_00, 'Comida')], 'ARS')
    expect(pairs.map((p) => p.key)).toEqual(['merchant:rappi'])
    expect(previousTotal).toEqual(ars(150_00))
  })
})
