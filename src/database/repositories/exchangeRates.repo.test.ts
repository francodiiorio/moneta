import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createExchangeRate, deleteExchangeRate, listExchangeRates } from './exchangeRates.repo'

afterEach(async () => {
  await db.exchangeRates.clear()
})

describe('createExchangeRate / listExchangeRates', () => {
  it('creates and lists rates, most recent first', async () => {
    await createExchangeRate({ date: '2026-06-01', from: 'USD', to: 'ARS', rate: 1000 })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1200 })
    await createExchangeRate({ date: '2026-07-01', from: 'USD', to: 'ARS', rate: 1100 })

    const rates = await listExchangeRates()
    expect(rates.map((r) => r.date)).toEqual(['2026-08-01', '2026-07-01', '2026-06-01'])
  })

  it('rejects a non-positive rate', async () => {
    await expect(createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 0 })).rejects.toThrow(
      /mayor a cero/,
    )
    await expect(createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: -5 })).rejects.toThrow(
      /mayor a cero/,
    )
    expect(await listExchangeRates()).toEqual([])
  })

  it('rejects the same currency on both sides', async () => {
    await expect(createExchangeRate({ date: '2026-08-01', from: 'ARS', to: 'ARS', rate: 1 })).rejects.toThrow(
      /distintas/,
    )
  })
})

describe('deleteExchangeRate', () => {
  it('removes a rate', async () => {
    const rate = await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1200 })
    await deleteExchangeRate(rate.id)
    expect(await listExchangeRates()).toEqual([])
  })
})
