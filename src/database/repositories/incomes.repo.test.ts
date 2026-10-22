import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createAccount } from './accounts.repo'
import { createCategory } from './categories.repo'
import { deleteIncome, listIncomesInRange, saveIncome, type IncomeInput } from './incomes.repo'

afterEach(async () => {
  await Promise.all([db.accounts.clear(), db.incomes.clear(), db.categories.clear()])
})

async function setup() {
  const account = await createAccount({
    name: 'Galicia',
    type: 'bank',
    currency: 'ARS',
    openingBalance: 0,
    openingDate: '2026-10-01',
  })
  const category = await createCategory({ kind: 'income', name: 'Sueldo' })
  return { account, category }
}

function input(accountId: string, categoryId: string, overrides: Partial<IncomeInput> = {}): IncomeInput {
  return {
    date: '2026-10-05',
    description: 'Sueldo octubre',
    categoryId,
    accountId,
    amount: 900_000_00,
    currency: 'ARS',
    ...overrides,
  }
}

describe('saveIncome', () => {
  it('persists an income', async () => {
    const { account, category } = await setup()
    const id = await saveIncome(input(account.id, category.id))
    expect(await db.incomes.get(id)).toMatchObject({ amount: 900_000_00, accountId: account.id })
  })

  it('rejects a non-positive amount', async () => {
    const { account, category } = await setup()
    await expect(saveIncome(input(account.id, category.id, { amount: 0 }))).rejects.toThrow(/mayor a cero/)
    expect(await db.incomes.count()).toBe(0)
  })

  it('rejects an account that does not exist', async () => {
    const { category } = await setup()
    await expect(saveIncome(input('nope', category.id))).rejects.toThrow(/Cuenta no encontrada/)
  })

  it('rejects a currency other than the account’s', async () => {
    const { account, category } = await setup()
    await expect(saveIncome(input(account.id, category.id, { currency: 'USD' }))).rejects.toThrow(/es en ARS/)
  })

  it('rejects a date before the account opening date', async () => {
    const { account, category } = await setup()
    await expect(saveIncome(input(account.id, category.id, { date: '2026-09-30' }))).rejects.toThrow(
      /saldo inicial/,
    )
  })

  it('rejects a gasto category', async () => {
    const { account } = await setup()
    const expenseCategory = await createCategory({ kind: 'expense', name: 'Comida' })
    await expect(saveIncome(input(account.id, expenseCategory.id))).rejects.toThrow(/no es una categoría de ingreso/)
  })

  it('editing overwrites in place, keeping createdAt', async () => {
    const { account, category } = await setup()
    const id = await saveIncome(input(account.id, category.id))
    const before = await db.incomes.get(id)
    await saveIncome(input(account.id, category.id, { amount: 1, description: 'Editado' }), id)
    expect(await db.incomes.count()).toBe(1)
    expect(await db.incomes.get(id)).toMatchObject({ amount: 1, description: 'Editado', createdAt: before?.createdAt })
  })
})

describe('listIncomesInRange / deleteIncome', () => {
  it('lists newest first within the range, and deletes', async () => {
    const { account, category } = await setup()
    await saveIncome(input(account.id, category.id, { date: '2026-10-02', description: 'A' }))
    const b = await saveIncome(input(account.id, category.id, { date: '2026-10-20', description: 'B' }))
    await saveIncome(input(account.id, category.id, { date: '2026-11-01', description: 'C' }))

    expect((await listIncomesInRange('2026-10-01', '2026-10-31')).map((i) => i.description)).toEqual(['B', 'A'])
    await deleteIncome(b)
    expect((await listIncomesInRange('2026-10-01', '2026-10-31')).map((i) => i.description)).toEqual(['A'])
  })
})
