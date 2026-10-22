import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  createAccount,
  deleteAccount,
  listAccountMovementRecords,
  listAccounts,
  updateAccount,
  type CreateAccountInput,
} from './accounts.repo'
import { createAdjustment } from './accountAdjustments.repo'
import { createCategory } from './categories.repo'
import { saveExpense } from './expenses.repo'
import { saveIncome } from './incomes.repo'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.incomes.clear(),
    db.expenses.clear(),
    db.accountAdjustments.clear(),
    db.categories.clear(),
  ])
})

function accountInput(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
  return {
    name: 'Galicia',
    type: 'bank',
    currency: 'ARS',
    openingBalance: 100_000,
    openingDate: '2026-10-01',
    ...overrides,
  }
}

async function incomeCategory() {
  return createCategory({ kind: 'income', name: 'Sueldo' })
}

describe('createAccount', () => {
  it('appends accounts in creation order', async () => {
    await createAccount(accountInput({ name: 'A' }))
    await createAccount(accountInput({ name: 'B' }))
    expect((await listAccounts()).map((a) => a.name)).toEqual(['A', 'B'])
  })

  it('starts unarchived', async () => {
    const account = await createAccount(accountInput())
    expect(account.isArchived).toBe(false)
  })
})

describe('updateAccount', () => {
  it('lets anything change while the account has no movements', async () => {
    const account = await createAccount(accountInput())
    await updateAccount(account.id, {
      ...accountInput({ name: 'Galicia USD', currency: 'USD', openingDate: '2026-11-01' }),
      notes: undefined,
    })
    expect(await db.accounts.get(account.id)).toMatchObject({
      name: 'Galicia USD',
      currency: 'USD',
      openingDate: '2026-11-01',
      createdAt: account.createdAt,
    })
  })

  it('refuses to change the currency once there are movements', async () => {
    const account = await createAccount(accountInput())
    const category = await incomeCategory()
    await saveIncome({
      date: '2026-10-05',
      description: 'Sueldo',
      categoryId: category.id,
      accountId: account.id,
      amount: 1000,
      currency: 'ARS',
    })
    await expect(
      updateAccount(account.id, { ...accountInput({ currency: 'USD' }), notes: undefined }),
    ).rejects.toThrow(/moneda/)
  })

  it('refuses to move the opening date past an existing movement', async () => {
    const account = await createAccount(accountInput())
    await createAdjustment({ accountId: account.id, date: '2026-10-05', amount: 10, currency: 'ARS' })

    await expect(
      updateAccount(account.id, { ...accountInput({ openingDate: '2026-10-06' }), notes: undefined }),
    ).rejects.toThrow(/primer movimiento/)
    // Up to the movement's own date is fine.
    await updateAccount(account.id, { ...accountInput({ openingDate: '2026-10-05' }), notes: undefined })
    expect((await db.accounts.get(account.id))?.openingDate).toBe('2026-10-05')
  })

  it('clears notes when sent as undefined', async () => {
    const account = await createAccount(accountInput({ notes: 'vieja' }))
    await updateAccount(account.id, { ...accountInput(), notes: undefined })
    expect((await db.accounts.get(account.id))?.notes).toBeUndefined()
  })
})

describe('deleteAccount', () => {
  it('deletes an account with no movements', async () => {
    const account = await createAccount(accountInput())
    await deleteAccount(account.id)
    expect(await db.accounts.count()).toBe(0)
  })

  it('refuses to delete an account that a debit gasto points at', async () => {
    const account = await createAccount(accountInput())
    const category = await createCategory({ kind: 'expense', name: 'Comida' })
    await saveExpense({
      date: '2026-10-02',
      description: 'Super',
      categoryId: category.id,
      amount: 500,
      currency: 'ARS',
      status: 'confirmed',
      accountId: account.id,
    })
    await expect(deleteAccount(account.id)).rejects.toThrow(/archivala/)
    expect(await db.accounts.count()).toBe(1)
  })
})

describe('listAccountMovementRecords', () => {
  it('returns incomes, adjustments, and only the gastos that have an account', async () => {
    const account = await createAccount(accountInput())
    const expenseCategory = await createCategory({ kind: 'expense', name: 'Comida' })
    const base = {
      date: '2026-10-02',
      description: 'Super',
      categoryId: expenseCategory.id,
      amount: 500,
      currency: 'ARS',
      status: 'confirmed' as const,
    }
    await saveExpense({ ...base, accountId: account.id })
    await saveExpense(base) // no account: credit card / unspecified
    await createAdjustment({ accountId: account.id, date: '2026-10-03', amount: -5, currency: 'ARS' })

    const records = await listAccountMovementRecords()
    expect(records.expenses).toHaveLength(1)
    expect(records.expenses[0]?.accountId).toBe(account.id)
    expect(records.adjustments).toHaveLength(1)
    expect(records.incomes).toHaveLength(0)
  })
})
