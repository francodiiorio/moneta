import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  createSavingsHolding,
  deleteSavingsHolding,
  listSavingsHoldings,
  updateSavingsHolding,
} from './savingsHoldings.repo'

afterEach(async () => {
  await db.savingsHoldings.clear()
})

describe('createSavingsHolding / listSavingsHoldings', () => {
  it('creates and lists holdings', async () => {
    await createSavingsHolding({ name: 'USD efectivo', currency: 'USD', amount: 250_000 })
    await createSavingsHolding({ name: 'Caja de ahorro', currency: 'ARS', amount: 3_500_000, location: 'Banco X' })

    const holdings = await listSavingsHoldings()
    expect(holdings.map((h) => h.name).sort()).toEqual(['Caja de ahorro', 'USD efectivo'])
    const caja = holdings.find((h) => h.name === 'Caja de ahorro')
    expect(caja?.location).toBe('Banco X')
  })

  it('omits optional fields when not provided', async () => {
    const holding = await createSavingsHolding({ name: 'USD efectivo', currency: 'USD', amount: 100 })
    expect('location' in holding).toBe(false)
    expect('notes' in holding).toBe(false)
  })
})

describe('updateSavingsHolding', () => {
  it('patches the given fields and bumps updatedAt', async () => {
    const holding = await createSavingsHolding({ name: 'USD efectivo', currency: 'USD', amount: 100 })
    await updateSavingsHolding(holding.id, { amount: 200, notes: 'ajustado' })

    const [updated] = await listSavingsHoldings()
    expect(updated?.amount).toBe(200)
    expect(updated?.notes).toBe('ajustado')
    expect(updated?.name).toBe('USD efectivo')
  })
})

describe('deleteSavingsHolding', () => {
  it('removes a holding', async () => {
    const holding = await createSavingsHolding({ name: 'USD efectivo', currency: 'USD', amount: 100 })
    await deleteSavingsHolding(holding.id)
    expect(await listSavingsHoldings()).toEqual([])
  })
})
