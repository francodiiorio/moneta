import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/database/db'
import { mergeAllTables } from '@/database/repositories/backup.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { createRecurringPlan, listRecurringPlans, setRecurringPlanPaused } from '@/database/repositories/recurringPlans.repo'
import * as recurringPlansRepoModule from '@/database/repositories/recurringPlans.repo'
import { createInstallmentPlan } from '@/database/repositories/installmentPlans.repo'
import * as expensesRepoModule from '@/database/repositories/expenses.repo'
import { generateId } from '@/lib/ids'
import { todayStamp } from '@/lib/dates'
import type { RecurrenceRule, ExpenseTemplate } from '@/domain/entities'
import {
  createRecurringPlanFromForm,
  listInstallmentPlansWithProgress,
  listRecurringPlansWithNext,
  materializeDue,
  MaterializationFailedError,
  removeRecurringPlan,
  setRecurringPlanPaused as setRecurringPlanPausedFromService,
  updateInstallmentPlanFromForm,
  updateRecurringPlanFromForm,
} from './service'

afterEach(async () => {
  await Promise.all([
    db.categories.clear(),
    db.expenses.clear(),
    db.recurringPlans.clear(),
    db.installmentPlans.clear(),
  ])
})

async function setup() {
  const category = await createCategory({ name: 'Alquiler' })
  return { category }
}

function template(categoryId: string): ExpenseTemplate {
  return { description: 'Alquiler', categoryId, amount: 100_000, currency: 'ARS' }
}

function recurringPlanFormValues(categoryId: string, overrides: Record<string, string> = {}) {
  return {
    description: 'Alquiler',
    categoryId,
    currency: 'ARS',
    amount: '1000',
    freq: 'monthly' as const,
    interval: '1',
    dayOfMonth: '',
    startDate: '2026-01-01',
    endDate: '',
    maxOccurrences: '',
    ...overrides,
  }
}

describe('materializeDue — recurring plans', () => {
  it('materializes only what is due as of today, nothing more', async () => {
    const { category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    await createRecurringPlan({ template: template(category.id), rule })

    const { recurringCreated } = await materializeDue('2026-08-15')
    expect(recurringCreated).toBe(3) // Jun, Jul, Aug

    const created = await db.expenses.toArray()
    expect(created.map((e) => e.date).sort()).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
    expect(created.every((e) => e.status === 'confirmed')).toBe(true)
  })

  it('running twice in a row does not duplicate anything', async () => {
    const { category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    await createRecurringPlan({ template: template(category.id), rule })

    await materializeDue('2026-08-15')
    const second = await materializeDue('2026-08-15')
    expect(second.recurringCreated).toBe(0)

    const created = await db.expenses.toArray()
    expect(created).toHaveLength(3)
  })

  it('two overlapping calls (e.g. App.tsx boot + a user action) never duplicate an expense', async () => {
    // Regression: materializeDue() reads every plan's lastMaterializedDate,
    // computes what's due, and only writes afterward — two calls started
    // before either has written anything would both compute the same
    // occurrence as due and both write it. materializeDue() (the exported
    // wrapper) queues calls instead of letting them run concurrently.
    const { category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    await createRecurringPlan({ template: template(category.id), rule })

    const [first, second] = await Promise.all([materializeDue('2026-08-15'), materializeDue('2026-08-15')])
    expect(first.recurringCreated + second.recurringCreated).toBe(3) // Jun, Jul, Aug — once each

    const created = await db.expenses.toArray()
    expect(created).toHaveLength(3)
    expect(created.map((e) => e.date).sort()).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
  })

  it('a later call only materializes the newly-due occurrences', async () => {
    const { category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    await createRecurringPlan({ template: template(category.id), rule })

    await materializeDue('2026-06-15') // only June due
    const second = await materializeDue('2026-08-15') // July + August newly due
    expect(second.recurringCreated).toBe(2)

    const created = await db.expenses.toArray()
    expect(created).toHaveLength(3)
  })

  it('a paused plan materializes nothing', async () => {
    const { category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    const plan = await createRecurringPlan({ template: template(category.id), rule })
    await setRecurringPlanPaused(plan.id, true)

    const { recurringCreated } = await materializeDue('2026-08-15')
    expect(recurringCreated).toBe(0)
    expect(await db.expenses.toArray()).toEqual([])
  })

  it('a plan whose endDate already passed materializes nothing new', async () => {
    const { category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-01-01', endDate: '2026-03-01' }
    await createRecurringPlan({ template: template(category.id), rule })

    await materializeDue('2026-03-15') // catches up through the endDate
    const { recurringCreated } = await materializeDue('2026-08-15') // nothing left to generate
    expect(recurringCreated).toBe(0)
    expect(await db.expenses.toArray()).toHaveLength(3) // Jan, Feb, Mar only
  })
})

describe('materializeDue — installment cuotas', () => {
  it('promotes a due projected cuota to confirmed', async () => {
    const { category } = await setup()
    await createInstallmentPlan(
      {
        description: 'Notebook',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 9_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-07-20', // "today" at creation time — every cuota is still projected
    )

    expect(await db.expenses.where('status').equals('confirmed').count()).toBe(0)

    const { installmentsConfirmed } = await materializeDue('2026-08-01')
    expect(installmentsConfirmed).toBe(1) // only the first cuota is due

    expect(await db.expenses.where('status').equals('confirmed').count()).toBe(1)
  })

  it('running twice in a row does not re-confirm or duplicate anything', async () => {
    const { category } = await setup()
    await createInstallmentPlan(
      {
        description: 'Notebook',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 9_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-07-20',
    )

    await materializeDue('2026-10-01') // all 3 cuotas due
    const second = await materializeDue('2026-10-01')
    expect(second.installmentsConfirmed).toBe(0)

    expect(await db.expenses.count()).toBe(3)
  })
})

describe('createRecurringPlanFromForm', () => {
  it('throws MaterializationFailedError but keeps the plan when its own materialization fails', async () => {
    // The plan write itself must NOT be rolled back just because the
    // immediate catch-up failed — see MaterializationFailedError's own
    // doc comment for why the caller (RecurringPlanFormDialog) treats
    // this differently from a plain validation failure.
    const spy = vi.spyOn(recurringPlansRepoModule, 'materializePlan').mockRejectedValueOnce(new Error('boom'))
    try {
      const { category } = await setup()

      await expect(
        createRecurringPlanFromForm(
          recurringPlanFormValues(category.id, { startDate: todayStamp() }), // due today, so materializeDue actually attempts it
        ),
      ).rejects.toThrow(MaterializationFailedError)

      const plans = await listRecurringPlans()
      expect(plans).toHaveLength(1) // the write succeeded; only the catch-up failed
      expect(await db.expenses.where('sourcePlanId').equals(plans[0]!.id).count()).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('also converts a full materializeDue() rejection (not just failedPlanIds) into MaterializationFailedError', async () => {
    // Regression: only the failedPlanIds path used to convert to
    // MaterializationFailedError — a wholesale rejection from
    // materializeDue() itself (e.g. confirmDueProjected throwing, unrelated
    // to this plan's own occurrence) used to propagate as a plain Error,
    // which RecurringPlanFormDialog's `instanceof MaterializationFailedError`
    // check wouldn't recognize — leaving the dialog open and inviting a
    // real duplicate plan on resubmit, the exact bug this type exists to
    // prevent.
    const spy = vi.spyOn(expensesRepoModule, 'confirmDueProjected').mockRejectedValueOnce(new Error('boom'))
    try {
      const { category } = await setup()

      await expect(
        createRecurringPlanFromForm(recurringPlanFormValues(category.id, { startDate: todayStamp() })),
      ).rejects.toThrow(MaterializationFailedError)

      expect(await listRecurringPlans()).toHaveLength(1) // the write succeeded regardless
    } finally {
      spy.mockRestore()
    }
  })
})

describe('updateRecurringPlanFromForm', () => {
  it('only affects occurrences materialized after the edit, never the ones already generated', async () => {
    // Both create and update auto-materialize as of "today", so the clock
    // needs to be controlled at each step to keep this test's intent
    // (Jan + Feb at the old amount, March at the new one) reproducible.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
      const { category } = await setup()
      await createRecurringPlanFromForm(recurringPlanFormValues(category.id))
      const [plan] = await listRecurringPlans()

      vi.setSystemTime(new Date('2026-02-15T12:00:00Z'))
      await materializeDue() // Feb, still at the old amount

      await updateRecurringPlanFromForm(
        plan!.id,
        recurringPlanFormValues(category.id, { description: 'Alquiler nuevo', amount: '2000' }),
      ) // still Feb 15 — March isn't due yet, so nothing new materializes here

      vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))
      await materializeDue() // March, at the new amount

      const expenses = await db.expenses.orderBy('date').toArray()
      expect(expenses.map((e) => e.amount)).toEqual([100_000, 100_000, 200_000])
      expect(expenses.map((e) => e.description)).toEqual(['Alquiler', 'Alquiler', 'Alquiler nuevo'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('updateInstallmentPlanFromForm', () => {
  it('rewrites still-projected cuotas in place, leaving confirmed ones untouched', async () => {
    const { category } = await setup()
    const otherCategory = await createCategory({ name: 'Tecnología' })
    const plan = await createInstallmentPlan(
      {
        description: 'Notebook',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 9_000,
        count: 3,
        firstDueDate: '2026-08-01',
        purchaseDate: '2026-07-15',
      },
      '2026-08-15', // first cuota (Aug) is already due -> confirmed; Sep/Oct stay projected
    )

    await updateInstallmentPlanFromForm(plan.id, {
      description: 'Notebook nueva',
      categoryId: otherCategory.id,
    })

    const expenses = await db.expenses.where('sourcePlanId').equals(plan.id).sortBy('date')
    expect(expenses.map((e) => ({ status: e.status, description: e.description, categoryId: e.categoryId }))).toEqual([
      { status: 'confirmed', description: 'Notebook (cuota 1/3)', categoryId: category.id },
      { status: 'projected', description: 'Notebook nueva (cuota 2/3)', categoryId: otherCategory.id },
      { status: 'projected', description: 'Notebook nueva (cuota 3/3)', categoryId: otherCategory.id },
    ])
  })
})

describe('listRecurringPlansWithNext / listInstallmentPlansWithProgress — orphaned category', () => {
  it('falls back to placeholders when the category was hard-deleted', async () => {
    const { category } = await setup()
    const recurringPlan = await createRecurringPlan({
      template: template(category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
    })
    const installmentPlan = await createInstallmentPlan(
      { description: 'Notebook', categoryId: category.id, currency: 'ARS', totalAmount: 3_000, count: 1, firstDueDate: '2099-01-01', purchaseDate: '2026-07-15' },
      '2026-07-20',
    )

    // Simulate an orphaned reference (categories are normally only
    // archived, never hard-deleted, by production code — see
    // categories.repo.ts — but a corrupted/hand-edited backup import could
    // still leave one dangling).
    await db.categories.delete(category.id)

    const [recurringItem] = await listRecurringPlansWithNext()
    expect(recurringItem?.id).toBe(recurringPlan.id)
    expect(recurringItem?.categoryLabel).toBe('—')

    const [installmentItem] = await listInstallmentPlansWithProgress()
    expect(installmentItem?.id).toBe(installmentPlan.id)
    expect(installmentItem?.categoryLabel).toBe('Categoría eliminada')
  })
})

describe('listRecurringPlansWithNext — generatedCount', () => {
  it('counts how many expenses a plan has already generated', async () => {
    const { category } = await setup()
    await createRecurringPlan({
      template: template(category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })
    await materializeDue('2026-08-15') // Jun, Jul, Aug -> 3 expenses

    const [item] = await listRecurringPlansWithNext()
    expect(item?.generatedCount).toBe(3)
  })

  it('is zero for a plan that has not materialized anything yet', async () => {
    const { category } = await setup()
    await createRecurringPlan({
      template: template(category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })

    const [item] = await listRecurringPlansWithNext()
    expect(item?.generatedCount).toBe(0)
  })
})

describe('removeRecurringPlan', () => {
  it('erases generated expenses when deleteGeneratedExpenses is true', async () => {
    const { category } = await setup()
    const plan = await createRecurringPlan({
      template: template(category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })
    await materializeDue('2026-08-15')
    expect(await db.expenses.where('sourcePlanId').equals(plan.id).count()).toBe(3)

    await removeRecurringPlan(plan.id, { deleteGeneratedExpenses: true })

    expect(await listRecurringPlans()).toEqual([])
    expect(await db.expenses.where('sourcePlanId').equals(plan.id).count()).toBe(0)
  })

  it('keeps generated expenses by default', async () => {
    const { category } = await setup()
    const plan = await createRecurringPlan({
      template: template(category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })
    await materializeDue('2026-08-15')

    await removeRecurringPlan(plan.id)

    expect(await db.expenses.where('sourcePlanId').equals(plan.id).count()).toBe(3)
  })
})

describe('setRecurringPlanPaused (service wrapper)', () => {
  it('backfills every occurrence missed while paused, in one shot, on un-pause', async () => {
    // The service wrapper (unlike the repo-level function used elsewhere
    // in this file) also triggers materializeDue() — this pins that it
    // correctly catches up ALL occurrences accumulated while paused, not
    // just the most recent one, exercising the exact path PlansPage's
    // pause toggle calls (the repo-level tests never go through it).
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
      const { category } = await setup()
      const plan = await createRecurringPlan({
        template: template(category.id),
        rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
      })
      await materializeDue() // June only, at the fake "today"
      expect(await db.expenses.where('sourcePlanId').equals(plan.id).count()).toBe(1)

      await setRecurringPlanPausedFromService(plan.id, true)

      // Three months pass while paused — nothing accumulates.
      vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
      expect(await db.expenses.where('sourcePlanId').equals(plan.id).count()).toBe(1)

      await setRecurringPlanPausedFromService(plan.id, false)

      // July, August, and September all land in this single un-pause call.
      const expenses = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
      expect(expenses).toHaveLength(4)
      expect(expenses.map((e) => e.date).sort()).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'])
      expect(expenses.reduce((sum, e) => sum + e.amount, 0)).toBe(400_000) // 4 * 100_000
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('materializeDue after a backup merge', () => {
  it('does not re-materialize occurrences merged in from another device', async () => {
    const { category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-01-01' }
    const plan = await createRecurringPlan({ template: template(category.id), rule })
    await db.recurringPlans.update(plan.id, { lastMaterializedDate: '2026-01-01' })
    await db.expenses.add({
      id: generateId(),
      date: '2026-01-01',
      amount: 100_000,
      currency: 'ARS',
      categoryId: category.id,
      description: 'Alquiler',
      status: 'confirmed',
      sourcePlanId: plan.id,
      occurrenceIndex: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Another device opened the app more recently and materialized ahead
    // — a real device's backup carries every occurrence it produced, in
    // order, never a gap — so its export includes both 02-01 and 03-01.
    await mergeAllTables({
      categories: [],
      expenses: [
        {
          id: generateId(),
          date: '2026-02-01',
          amount: 100_000,
          currency: 'ARS',
          categoryId: category.id,
          description: 'Alquiler',
          status: 'confirmed',
          sourcePlanId: plan.id,
          occurrenceIndex: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: generateId(),
          date: '2026-03-01',
          amount: 100_000,
          currency: 'ARS',
          categoryId: category.id,
          description: 'Alquiler',
          status: 'confirmed',
          sourcePlanId: plan.id,
          occurrenceIndex: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      recurringPlans: [],
      installmentPlans: [],
      budgets: [],
      exchangeRates: [],
      savingsHoldings: [],
      investmentAssets: [],
      investmentHoldings: [],
      assetPrices: [],
      investmentLots: [],
    })

    // Without the watermark repair in mergeAllTables, lastMaterializedDate
    // would still be the pre-merge 2026-01-01, and this would treat
    // 2026-02-01/2026-03-01 as still due, duplicating both.
    const { recurringCreated } = await materializeDue('2026-03-15')
    expect(recurringCreated).toBe(0)

    const planExpenses = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(planExpenses.map((e) => e.date).sort()).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
})
