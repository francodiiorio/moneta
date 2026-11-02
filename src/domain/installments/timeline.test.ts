import { describe, expect, it } from 'vitest'
import { money } from '@/domain/money'
import { cuotaTimeline } from './timeline'

const ars = (amount: number) => money(amount, 'ARS')

describe('cuotaTimeline', () => {
  it('adds up each month from `from` on, fills the gaps and says when the last plan ends', () => {
    const timeline = cuotaTimeline(
      [
        { planId: 'tele', month: '2026-11', amount: ars(100_00) },
        { planId: 'tele', month: '2026-12', amount: ars(100_00) },
        { planId: 'heladera', month: '2026-11', amount: ars(50_01) },
        { planId: 'heladera', month: '2027-02', amount: ars(50_00) },
        // Before `from`: history, left out.
        { planId: 'viejo', month: '2026-10', amount: ars(999_00) },
      ],
      '2026-11',
    )
    expect(timeline.months).toEqual([
      { month: '2026-11', totals: [ars(150_01)], endingPlanIds: [] },
      { month: '2026-12', totals: [ars(100_00)], endingPlanIds: ['tele'] },
      { month: '2027-01', totals: [], endingPlanIds: [] },
      { month: '2027-02', totals: [ars(50_00)], endingPlanIds: ['heladera'] },
    ])
    expect(timeline.freeFrom).toBe('2027-03')
  })

  it('keeps each currency apart, in a stable order', () => {
    const { months } = cuotaTimeline(
      [
        { planId: 'a', month: '2026-11', amount: money(10_00, 'USD') },
        { planId: 'b', month: '2026-11', amount: ars(5_00) },
        { planId: 'c', month: '2026-11', amount: money(2_50, 'USD') },
      ],
      '2026-11',
    )
    expect(months[0]?.totals).toEqual([ars(5_00), money(12_50, 'USD')])
  })

  it('a single cuota this month: free from the next one', () => {
    expect(cuotaTimeline([{ planId: 'a', month: '2026-11', amount: ars(1_00) }], '2026-11')).toEqual({
      months: [{ month: '2026-11', totals: [ars(1_00)], endingPlanIds: ['a'] }],
      freeFrom: '2026-12',
    })
  })

  it('two plans ending the same month; a plan only ends by its cuotas ahead', () => {
    const { months } = cuotaTimeline(
      [
        { planId: 'a', month: '2026-10', amount: ars(1_00) },
        { planId: 'a', month: '2026-11', amount: ars(1_00) },
        { planId: 'b', month: '2026-11', amount: ars(2_00) },
        // Ended before `from`: never "ending" in the timeline.
        { planId: 'c', month: '2026-09', amount: ars(3_00) },
      ],
      '2026-11',
    )
    expect(months).toEqual([{ month: '2026-11', totals: [ars(3_00)], endingPlanIds: ['a', 'b'] }])
  })

  it('with no cuotas ahead there is no timeline and nothing to be free from', () => {
    expect(cuotaTimeline([{ planId: 'a', month: '2026-01', amount: ars(1_00) }], '2026-11')).toEqual({ months: [], freeFrom: undefined })
  })
})
