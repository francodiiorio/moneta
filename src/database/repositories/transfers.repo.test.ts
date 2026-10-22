import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createAccount, deleteAccount, updateAccount } from './accounts.repo'
import { deleteTransfer, listTransfersInRange, saveTransfer, type TransferInput } from './transfers.repo'

afterEach(async () => {
  await Promise.all([db.accounts.clear(), db.transfers.clear()])
})

async function setup() {
  const base = { type: 'bank' as const, openingBalance: 0, openingDate: '2026-10-01' }
  const ars = await createAccount({ ...base, name: 'Galicia', currency: 'ARS' })
  const ars2 = await createAccount({ ...base, name: 'Mercado Pago', currency: 'ARS' })
  const usd = await createAccount({ ...base, name: 'Caja USD', currency: 'USD' })
  return { ars, ars2, usd }
}

function input(from: string, to: string, overrides: Partial<TransferInput> = {}): TransferInput {
  return {
    date: '2026-10-08',
    fromAccountId: from,
    toAccountId: to,
    fromAmount: 1_250_000_00,
    toAmount: 1_000_00,
    description: 'Compra de dólares',
    expectedFromCurrency: 'ARS',
    expectedToCurrency: 'USD',
    ...overrides,
  }
}

describe('saveTransfer', () => {
  it('stores both real amounts and takes each currency from its account', async () => {
    const { ars, usd } = await setup()
    const id = await saveTransfer(input(ars.id, usd.id))
    expect(await db.transfers.get(id)).toMatchObject({
      fromAmount: 1_250_000_00,
      fromCurrency: 'ARS',
      toAmount: 1_000_00,
      toCurrency: 'USD',
    })
  })

  it('rejects different amounts between two accounts of the same currency', async () => {
    const { ars, ars2 } = await setup()
    await expect(saveTransfer(input(ars.id, ars2.id, { fromAmount: 100, toAmount: 99, expectedToCurrency: 'ARS' }))).rejects.toThrow(/iguales/)
    expect(await db.transfers.count()).toBe(0)
  })

  it('rejects the same account on both sides', async () => {
    const { ars } = await setup()
    await expect(saveTransfer(input(ars.id, ars.id, { toAmount: 1_250_000_00, expectedToCurrency: 'ARS' }))).rejects.toThrow(/distintas/)
  })

  it('rejects a date before an opening date', async () => {
    const { ars, usd } = await setup()
    await expect(saveTransfer(input(ars.id, usd.id, { date: '2026-09-30' }))).rejects.toThrow(/saldo inicial/)
  })

  it('rejects a missing account', async () => {
    const { ars } = await setup()
    await expect(saveTransfer(input(ars.id, 'nope'))).rejects.toThrow(/Cuenta no encontrada/)
  })

  it('editing overwrites in place, keeping createdAt', async () => {
    const { ars, ars2 } = await setup()
    const id = await saveTransfer(input(ars.id, ars2.id, { fromAmount: 500, toAmount: 500, expectedToCurrency: 'ARS' }))
    const before = await db.transfers.get(id)
    await saveTransfer(input(ars.id, ars2.id, { fromAmount: 700, toAmount: 700, description: 'Editada', expectedToCurrency: 'ARS' }), id)
    expect(await db.transfers.count()).toBe(1)
    expect(await db.transfers.get(id)).toMatchObject({ fromAmount: 700, description: 'Editada', createdAt: before?.createdAt })
  })
})

describe('transfers as account movements', () => {
  it('an incoming transfer blocks deleting the destination account', async () => {
    const { ars, usd } = await setup()
    await saveTransfer(input(ars.id, usd.id))
    await expect(deleteAccount(usd.id)).rejects.toThrow(/archivala/)
  })

  it('an outgoing transfer blocks changing the origin account currency', async () => {
    const { ars, usd } = await setup()
    await saveTransfer(input(ars.id, usd.id))
    await expect(
      updateAccount(ars.id, {
        name: 'Galicia',
        type: 'bank',
        currency: 'USD',
        openingBalance: 0,
        openingDate: '2026-10-01',
        notes: undefined,
      }),
    ).rejects.toThrow(/moneda/)
  })

  it('lists by date range and deletes', async () => {
    const { ars, ars2 } = await setup()
    const id = await saveTransfer(input(ars.id, ars2.id, { fromAmount: 1, toAmount: 1, expectedToCurrency: 'ARS' }))
    expect(await listTransfersInRange('2026-10-01', '2026-10-31')).toHaveLength(1)
    await deleteTransfer(id)
    expect(await listTransfersInRange('2026-10-01', '2026-10-31')).toHaveLength(0)
  })
})

describe('saveTransfer — hallazgos de revisión', () => {
  it('rejects amounts parsed for a currency the account no longer has', async () => {
    const { ars, ars2 } = await setup()
    // The caller parsed both sides as ARS; meanwhile ars2 became USD.
    await db.accounts.update(ars2.id, { currency: 'USD' })
    await expect(
      saveTransfer(input(ars.id, ars2.id, { fromAmount: 500, toAmount: 500, expectedToCurrency: 'ARS' })),
    ).rejects.toThrow(/cambió/)
    expect(await db.transfers.count()).toBe(0)
  })

  it('editing keeps notes the form never shows', async () => {
    const { ars, ars2 } = await setup()
    const id = await saveTransfer(input(ars.id, ars2.id, { fromAmount: 5, toAmount: 5, expectedToCurrency: 'ARS', notes: 'del backup' }))
    await saveTransfer(input(ars.id, ars2.id, { fromAmount: 6, toAmount: 6, expectedToCurrency: 'ARS' }), id)
    expect((await db.transfers.get(id))?.notes).toBe('del backup')
  })

  it('an incoming transfer blocks moving the destination opening date past it', async () => {
    const { ars, usd } = await setup()
    await saveTransfer(input(ars.id, usd.id))
    await expect(
      updateAccount(usd.id, { name: 'Caja USD', type: 'bank', currency: 'USD', openingBalance: 0, openingDate: '2026-10-09', notes: undefined }),
    ).rejects.toThrow(/primer movimiento/)
  })
})
