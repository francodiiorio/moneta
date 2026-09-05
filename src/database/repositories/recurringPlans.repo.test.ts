import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createCategory } from './categories.repo'
import {
  createRecurringPlan,
  deleteRecurringPlan,
  listRecurringPlans,
  materializePlan,
  setRecurringPlanPaused,
  updateRecurringPlan,
} from './recurringPlans.repo'
import type { ExpenseInput } from './expenses.repo'
import type { RecurrenceRule, ExpenseTemplate } from '@/domain/entities'

afterEach(async () => {
  await Promise.all([db.categories.clear(), db.expenses.clear(), db.recurringPlans.clear()])
})

const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-01-01' }

async function setup() {
  const category = await createCategory({ name: 'Alquiler' })
  const template: ExpenseTemplate = {
    description: 'Alquiler',
    categoryId: category.id,
    amount: 100_000,
    currency: 'ARS',
  }
  return { category, template }
}

function expenseInput(overrides: Partial<ExpenseInput> & Pick<ExpenseInput, 'date' | 'categoryId'>): ExpenseInput {
  return {
    description: 'Alquiler',
    amount: 100_000,
    currency: 'ARS',
    status: 'confirmed',
    ...overrides,
  }
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

  it('deletes the plan but leaves already-materialized expenses untouched', async () => {
    const { template, category } = await setup()
    const plan = await createRecurringPlan({ template, rule })
    const entry = expenseInput({
      date: '2026-01-01',
      categoryId: category.id,
      sourcePlanId: plan.id,
      occurrenceIndex: 0,
    })
    await materializePlan(plan.id, [entry], '2026-01-01')

    await deleteRecurringPlan(plan.id)

    expect(await listRecurringPlans()).toEqual([])
    const kept = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(kept).toHaveLength(1)
    expect(kept[0]?.status).toBe('confirmed')
  })

  it('deletes generated expenses when deleteGeneratedExpenses is true', async () => {
    const { template, category } = await setup()
    const plan = await createRecurringPlan({ template, rule })
    const entry = expenseInput({
      date: '2026-01-01',
      categoryId: category.id,
      sourcePlanId: plan.id,
      occurrenceIndex: 0,
    })
    await materializePlan(plan.id, [entry], '2026-01-01')
    const [expense] = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(expense).toBeDefined()

    await deleteRecurringPlan(plan.id, { deleteGeneratedExpenses: true })

    expect(await listRecurringPlans()).toEqual([])
    expect(await db.expenses.where('sourcePlanId').equals(plan.id).toArray()).toEqual([])
  })
})

describe('updateRecurringPlan', () => {
  it('overwrites template/rule and preserves lastMaterializedDate and isPaused', async () => {
    const { template, category } = await setup()
    const plan = await createRecurringPlan({ template, rule })
    await materializePlan(
      plan.id,
      [expenseInput({ date: '2026-01-01', categoryId: category.id, sourcePlanId: plan.id, occurrenceIndex: 0 })],
      '2026-01-01',
    )
    await setRecurringPlanPaused(plan.id, true)

    const newRule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2025-12-01' }
    const updated = await updateRecurringPlan(plan.id, {
      template: { ...template, description: 'Alquiler nuevo', amount: 200_000 },
      rule: newRule,
    })

    expect(updated.template.description).toBe('Alquiler nuevo')
    expect(updated.template.amount).toBe(200_000)
    expect(updated.rule).toEqual(newRule)
    // A patch, not a full overwrite — fields updateRecurringPlan doesn't
    // touch survive exactly as materializePlan/setRecurringPlanPaused left
    // them (the regression this guards: a get-then-put built from a stale
    // read would silently roll lastMaterializedDate back).
    expect(updated.lastMaterializedDate).toBe('2026-01-01')
    expect(updated.isPaused).toBe(true)

    const [persisted] = await listRecurringPlans()
    expect(persisted).toEqual(updated)
  })

  it('rejects a non-positive template amount, leaving the plan untouched', async () => {
    const { template } = await setup()
    const plan = await createRecurringPlan({ template, rule })

    await expect(updateRecurringPlan(plan.id, { template: { ...template, amount: 0 }, rule })).rejects.toThrow(
      /mayor a cero/,
    )

    const [unchanged] = await listRecurringPlans()
    expect(unchanged?.template.amount).toBe(100_000)
  })

  it('throws for an id that does not exist', async () => {
    const { template } = await setup()
    await expect(updateRecurringPlan('no-existe', { template, rule })).rejects.toThrow(/No se encontró/)
  })
})

describe('materializePlan', () => {
  it('writes every entry and advances lastMaterializedDate atomically', async () => {
    const { template, category } = await setup()
    const plan = await createRecurringPlan({ template, rule })

    const entries = ['2026-01-01', '2026-02-01'].map((date, index) =>
      expenseInput({ date, categoryId: category.id, sourcePlanId: plan.id, occurrenceIndex: index }),
    )
    await materializePlan(plan.id, entries, '2026-02-01')

    const [updated] = await listRecurringPlans()
    expect(updated?.lastMaterializedDate).toBe('2026-02-01')
    const written = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(written).toHaveLength(2)
    expect(written.every((e) => e.status === 'confirmed')).toBe(true)
  })

  it('is a no-op given an empty entries list', async () => {
    const { template } = await setup()
    const plan = await createRecurringPlan({ template, rule })
    await materializePlan(plan.id, [], '2026-02-01')
    const [unchanged] = await listRecurringPlans()
    expect(unchanged?.lastMaterializedDate).toBeUndefined()
  })
})
