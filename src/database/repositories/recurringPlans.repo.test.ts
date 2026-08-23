import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createAccount } from './accounts.repo'
import { createCategory } from './categories.repo'
import {
  createRecurringPlan,
  deleteRecurringPlan,
  listRecurringPlans,
  materializePlan,
  setRecurringPlanPaused,
} from './recurringPlans.repo'
import { buildExpense } from '@/domain/ledger'
import { minor, money } from '@/domain/money'
import type { RecurrenceRule, TransactionTemplate } from '@/domain/entities'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
    db.recurringPlans.clear(),
  ])
})

const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-01-01' }

async function setup() {
  const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
  const category = await createCategory({ name: 'Alquiler', kind: 'expense' })
  const template: TransactionTemplate = {
    description: 'Alquiler',
    kind: 'expense',
    accountId: account.id,
    categoryId: category.id,
    amount: 100_000,
    currency: 'ARS',
  }
  return { account, category, template }
}

describe('createRecurringPlan / listRecurringPlans', () => {
  it('creates a plan, not paused by default', async () => {
    const { template } = await setup()
    const plan = await createRecurringPlan({ template, rule })
    expect(plan.isPaused).toBe(false)
    expect(plan.lastMaterializedDate).toBeUndefined()
    expect(await listRecurringPlans()).toHaveLength(1)
  })

  it('rejects a non-positive template amount', async () => {
    const { template } = await setup()
    await expect(createRecurringPlan({ template: { ...template, amount: 0 }, rule })).rejects.toThrow(/mayor a cero/)
    expect(await listRecurringPlans()).toEqual([])
  })
})

describe('setRecurringPlanPaused / deleteRecurringPlan', () => {
  it('toggles isPaused', async () => {
    const { template } = await setup()
    const plan = await createRecurringPlan({ template, rule })
    await setRecurringPlanPaused(plan.id, true)
    expect((await listRecurringPlans())[0]?.isPaused).toBe(true)
  })

  it('deletes the plan but leaves already-materialized transactions untouched', async () => {
    const { template, account, category } = await setup()
    const plan = await createRecurringPlan({ template, rule })
    const entry = buildExpense({
      date: '2026-01-01',
      description: 'Alquiler',
      accountId: account.id,
      categoryId: category.id,
      amount: money(100_000, 'ARS'),
      sourcePlanId: plan.id,
      occurrenceIndex: 0,
    })
    await materializePlan(plan.id, [entry], '2026-01-01')

    await deleteRecurringPlan(plan.id)

    expect(await listRecurringPlans()).toEqual([])
    const kept = await db.transactions.where('sourcePlanId').equals(plan.id).toArray()
    expect(kept).toHaveLength(1)
    expect(kept[0]?.status).toBe('confirmed')
  })
})

describe('materializePlan', () => {
  it('writes every entry and advances lastMaterializedDate atomically', async () => {
    const { template, account, category } = await setup()
    const plan = await createRecurringPlan({ template, rule })

    const entries = ['2026-01-01', '2026-02-01'].map((date, index) =>
      buildExpense({
        date,
        description: 'Alquiler',
        accountId: account.id,
        categoryId: category.id,
        amount: money(100_000, 'ARS'),
        sourcePlanId: plan.id,
        occurrenceIndex: index,
      }),
    )
    await materializePlan(plan.id, entries, '2026-02-01')

    const [updated] = await listRecurringPlans()
    expect(updated?.lastMaterializedDate).toBe('2026-02-01')
    const written = await db.transactions.where('sourcePlanId').equals(plan.id).toArray()
    expect(written).toHaveLength(2)
    expect(written.every((t) => t.status === 'confirmed')).toBe(true)
  })

  it('is a no-op given an empty entries list', async () => {
    const { template } = await setup()
    const plan = await createRecurringPlan({ template, rule })
    await materializePlan(plan.id, [], '2026-02-01')
    const [unchanged] = await listRecurringPlans()
    expect(unchanged?.lastMaterializedDate).toBeUndefined()
  })
})
