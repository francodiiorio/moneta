import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  createAccount,
  listAccountsWithBalances,
  setAccountArchived,
  updateAccount,
} from './accounts.repo'
import { generateId } from '@/lib/ids'
import { minor } from '@/domain/money'

afterEach(async () => {
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.postings.clear()])
})

describe('createAccount', () => {
  it('assigns an incrementing order and defaults', async () => {
    const a = await createAccount({
      name: 'Banco',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(0),
    })
    const b = await createAccount({
      name: 'Efectivo',
      type: 'cash',
      currency: 'ARS',
      openingBalance: minor(0),
    })
    expect(a.order).toBe(0)
    expect(b.order).toBe(1)
    expect(a.isArchived).toBe(false)
  })
})

describe('listAccountsWithBalances', () => {
  it('uses the opening balance when there are no postings', async () => {
    await createAccount({
      name: 'Banco',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(10_000),
    })
    const [account] = await listAccountsWithBalances()
    expect(account?.balance).toBe(10_000)
  })

  it('adds confirmed postings and ignores projected ones', async () => {
    const account = await createAccount({
      name: 'Banco',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(10_000),
    })

    const confirmedTxId = generateId()
    await db.transactions.add({
      id: confirmedTxId,
      date: '2026-08-23',
      kind: 'expense',
      description: 'Compra',
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await db.postings.add({
      id: generateId(),
      transactionId: confirmedTxId,
      target: 'account',
      accountId: account.id,
      amount: -1500,
      currency: 'ARS',
      date: '2026-08-23',
    })

    const projectedTxId = generateId()
    await db.transactions.add({
      id: projectedTxId,
      date: '2026-09-23',
      kind: 'expense',
      description: 'Cuota futura',
      status: 'projected',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await db.postings.add({
      id: generateId(),
      transactionId: projectedTxId,
      target: 'account',
      accountId: account.id,
      amount: -5000,
      currency: 'ARS',
      date: '2026-09-23',
    })

    const [result] = await listAccountsWithBalances()
    expect(result?.balance).toBe(8_500) // 10000 - 1500, projected posting excluded
  })

  it('orders accounts by their order field', async () => {
    await createAccount({
      name: 'Segunda',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(0),
    })
    await createAccount({
      name: 'Primera',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(0),
    })
    const first = await listAccountsWithBalances()
    expect(first.map((a) => a.name)).toEqual(['Segunda', 'Primera'])
  })
})

describe('updateAccount / setAccountArchived', () => {
  it('updates fields and bumps updatedAt', async () => {
    const account = await createAccount({
      name: 'Banco',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(0),
    })
    await updateAccount(account.id, { name: 'Banco Renombrado' })
    const updated = await db.accounts.get(account.id)
    expect(updated).toBeDefined()
    expect(updated?.name).toBe('Banco Renombrado')
    expect(updated!.updatedAt >= account.updatedAt).toBe(true)
  })

  it('archives an account', async () => {
    const account = await createAccount({
      name: 'Banco',
      type: 'bank',
      currency: 'ARS',
      openingBalance: minor(0),
    })
    await setAccountArchived(account.id, true)
    const updated = await db.accounts.get(account.id)
    expect(updated?.isArchived).toBe(true)
  })
})
