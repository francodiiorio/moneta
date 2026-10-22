import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createAccount } from './accounts.repo'
import { createAdjustment, deleteAdjustment, listAdjustmentsByAccount } from './accountAdjustments.repo'

afterEach(async () => {
  await Promise.all([db.accounts.clear(), db.accountAdjustments.clear()])
})

async function account() {
  return createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-10-01' })
}

describe('createAdjustment', () => {
  it('stores a signed adjustment', async () => {
    const { id } = await account()
    await createAdjustment({ accountId: id, date: '2026-10-10', amount: -150, currency: 'ARS', description: 'Comisión' })
    expect(await listAdjustmentsByAccount(id)).toEqual([
      expect.objectContaining({ amount: -150, description: 'Comisión' }),
    ])
  })

  it('rejects a zero adjustment', async () => {
    const { id } = await account()
    await expect(createAdjustment({ accountId: id, date: '2026-10-10', amount: 0, currency: 'ARS' })).rejects.toThrow(
      /cero/,
    )
  })

  it('rejects a non-integer amount', async () => {
    const { id } = await account()
    await expect(
      createAdjustment({ accountId: id, date: '2026-10-10', amount: 1.5, currency: 'ARS' }),
    ).rejects.toThrow(/entero/)
  })

  it('rejects a date before the opening date', async () => {
    const { id } = await account()
    await expect(
      createAdjustment({ accountId: id, date: '2026-09-01', amount: 1, currency: 'ARS' }),
    ).rejects.toThrow(/saldo inicial/)
  })

  it('deletes', async () => {
    const { id } = await account()
    const adjustment = await createAdjustment({ accountId: id, date: '2026-10-10', amount: 1, currency: 'ARS' })
    await deleteAdjustment(adjustment.id)
    expect(await listAdjustmentsByAccount(id)).toEqual([])
  })
})
