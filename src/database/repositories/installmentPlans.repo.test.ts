import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createAccount } from './accounts.repo'
import { createCategory } from './categories.repo'
import { createInstallmentPlan, deleteInstallmentPlan, listInstallmentPlans } from './installmentPlans.repo'
import { minor } from '@/domain/money'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
    db.installmentPlans.clear(),
  ])
})

async function setup() {
  const account = await createAccount({ name: 'Tarjeta', type: 'card', currency: 'ARS', openingBalance: minor(0) })
  const category = await createCategory({ name: 'Compras', kind: 'expense' })
  return { account, category }
}

describe('createInstallmentPlan', () => {
  it('writes N transactions matching scheduleCache, confirmed on/before today and projected after', async () => {
    const { account, category } = await setup()

    const plan = await createInstallmentPlan(
      {
        description: 'Notebook',
        accountId: account.id,
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 10_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-08-15', // "today" — only the first cuota (2026-08-01) is due
    )

    expect(plan.scheduleCache.reduce((a, b) => a + b, 0)).toBe(10_000)
    expect(await listInstallmentPlans()).toHaveLength(1)

    const transactions = await db.transactions.where('sourcePlanId').equals(plan.id).toArray()
    expect(transactions).toHaveLength(3)
    transactions.sort((a, b) => a.date.localeCompare(b.date))
    expect(transactions.map((t) => t.status)).toEqual(['confirmed', 'projected', 'projected'])
    expect(transactions.map((t) => t.date)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
  })

  it('does not move the account balance for projected cuotas', async () => {
    const { account, category } = await setup()

    await createInstallmentPlan(
      {
        description: 'Notebook',
        accountId: account.id,
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 9_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-06-01', // "today" is before every cuota — all projected
    )

    const projected = await db.transactions.where('status').equals('projected').toArray()
    expect(projected).toHaveLength(3)
  })

  it('rejects a non-positive total or count', async () => {
    const { account, category } = await setup()
    const base = {
      description: 'Notebook',
      accountId: account.id,
      categoryId: category.id,
      currency: 'ARS' as const,
      firstDueDate: '2026-08-01',
      purchaseDate: '2026-07-15',
    }
    await expect(createInstallmentPlan({ ...base, totalAmount: 0, count: 3 })).rejects.toThrow(/mayor a cero/)
    await expect(createInstallmentPlan({ ...base, totalAmount: 9_000, count: 0 })).rejects.toThrow(/mayor a cero/)
    expect(await listInstallmentPlans()).toEqual([])
  })
})

describe('deleteInstallmentPlan', () => {
  it('deletes projected cuotas but keeps confirmed ones', async () => {
    const { account, category } = await setup()
    const plan = await createInstallmentPlan(
      {
        description: 'Notebook',
        accountId: account.id,
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 9_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-08-15', // only the first cuota is confirmed
    )

    await deleteInstallmentPlan(plan.id)

    expect(await listInstallmentPlans()).toEqual([])
    const remaining = await db.transactions.where('sourcePlanId').equals(plan.id).toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.status).toBe('confirmed')
  })
})
