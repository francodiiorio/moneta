import { afterEach, describe, expect, it, vi } from 'vitest'
import { money } from '@/domain/money'
import { db } from '@/database/db'
import { mergeAllTables } from '@/database/repositories/backup.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { createRecurringPlan, listRecurringPlans, setRecurringPlanPaused } from '@/database/repositories/recurringPlans.repo'
import * as recurringPlansRepoModule from '@/database/repositories/recurringPlans.repo'
import { createInstallmentPlan } from '@/database/repositories/installmentPlans.repo'
import { createCreditCard } from '@/database/repositories/creditCards.repo'
import * as expensesRepoModule from '@/database/repositories/expenses.repo'
import { generateId } from '@/lib/ids'
import { todayStamp } from '@/lib/dates'
import type { RecurrenceRule, ExpenseTemplate } from '@/domain/entities'
import {
  createRecurringPlanFromForm,
  getCuotaTimeline,
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
  const category = await createCategory({ kind: 'expense', name: 'Alquiler' })
  return { category }
}

function template(categoryId: string): ExpenseTemplate {
  return { description: 'Alquiler', categoryId, amount: 100_000, currency: 'ARS' }
}

function recurringPlanFormValues(categoryId: string, overrides: Record<string, string> = {}) {
  return {
    kind: 'expense' as const,
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
    paymentMethod: '',
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
    const otherCategory = await createCategory({ kind: 'expense', name: 'Tecnología' })
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
      accounts: [],
      incomes: [],
      accountAdjustments: [],
      transfers: [],
      creditCards: [],
      cardStatements: [],
      statementPayments: [],
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

describe('planes con medio de pago (Fase 4b)', () => {
  afterEach(async () => {
    await Promise.all([db.creditCards.clear(), db.cardStatements.clear(), db.accounts.clear()])
  })

  it('a plan from before Etapa 10 that names a debit account still generates gastos — without the account', async () => {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
    const category = await createCategory({ kind: 'expense', name: 'Servicios' })
    const plan = await createRecurringPlan({
      template: { description: 'Luz', categoryId: category.id, amount: 100, currency: 'ARS', accountId: account.id },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-02-01' },
    })
    await materializeDue('2026-04-15')
    const generated = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(generated.length).toBeGreaterThan(0)
    for (const expense of generated) expect(expense).not.toHaveProperty('accountId')
  })

  it('a salary plan from before Etapa 10 that names an account generates ingresos — without the account', async () => {
    const { createAccount } = await import('@/database/repositories/accounts.repo')
    const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
    const category = await createCategory({ kind: 'income', name: 'Sueldo' })
    const plan = await createRecurringPlan({
      kind: 'income',
      template: { description: 'Sueldo', categoryId: category.id, amount: 100, currency: 'ARS', accountId: account.id },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-02-01' },
    })
    await materializeDue('2026-04-15')
    const generated = (await db.incomes.toArray()).filter((i) => i.sourcePlanId === plan.id)
    expect(generated.length).toBeGreaterThan(0)
    for (const income of generated) expect(income).not.toHaveProperty('accountId')
    await Promise.all([db.incomes.clear(), db.accounts.clear()])
  })

  it('an installment purchase with a card ignores the first-cuota date and starts at the purchase', async () => {
    const { createCreditCard } = await import('@/database/repositories/creditCards.repo')
    const { createInstallmentPlanFromForm } = await import('./service')
    const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
    const category = await createCategory({ kind: 'expense', name: 'Hogar' })
    const plan = await createInstallmentPlanFromForm({
      description: 'Sillón',
      categoryId: category.id,
      currency: 'ARS',
      totalAmount: '90.000',
      count: '3',
      alreadyPaying: false,
      currentCuota: '',
      currentCuotaInOpening: false,
      firstDueDate: '2099-01-01',
      purchaseDate: '2026-07-15',
      cardId: card.id,
    })
    expect(plan).toMatchObject({ firstDueDate: '2026-07-15', cardId: card.id })
    const cuotas = await db.expenses.where('sourcePlanId').equals(plan.id).sortBy('date')
    expect(cuotas.map((c) => c.statementPeriod)).toEqual(['2026-07', '2026-08', '2026-09'])
  })
})

describe('listInstallmentPlansWithProgress — con tarjeta, como cuenta el banco', () => {
  afterEach(async () => {
    await Promise.all([db.creditCards.clear(), db.cardStatements.clear()])
  })

  it('a Sep 30 purchase in 6 cuotas: after October closes, cuota 2/6 is in the open statement and 4 remain to be billed', async () => {
    const { createCreditCard } = await import('@/database/repositories/creditCards.repo')
    const { category } = await setup()
    const card = await createCreditCard({ name: 'Visa', closingDay: 23, dueDay: 5 })
    await createInstallmentPlan(
      {
        description: 'Cubiertas',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 528_240_00,
        count: 6,
        firstDueDate: '2026-09-30',
        purchaseDate: '2026-09-30',
        cardId: card.id,
      },
      '2026-10-25',
    )

    const [item] = await listInstallmentPlansWithProgress('2026-10-25')
    // By date, only cuota 1 has come (cuota 2 is dated Oct 30)…
    expect(item?.confirmedCount).toBe(1)
    // …but the bank already bills cuota 2 in the statement open today.
    expect(item?.cardProgress?.stage).toEqual({ kind: 'billing', number: 2, period: '2026-11', inOpenStatement: true })
    expect(item?.cardProgress?.unbilledCount).toBe(4)
    expect(item?.cardProgress?.unbilled).toEqual(money(4 * 88_040_00, 'ARS'))
  })

  it('editing a cuota from Movimientos keeps it in its plan — same link, still projected', async () => {
    const { createCreditCard } = await import('@/database/repositories/creditCards.repo')
    const { saveExpense: saveExpenseFromForm } = await import('@/features/transactions/service')
    const { category } = await setup()
    const card = await createCreditCard({ name: 'Visa', closingDay: 23, dueDay: 5 })
    const plan = await createInstallmentPlan(
      {
        description: 'Cubiertas',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 528_240_00,
        count: 6,
        firstDueDate: '2026-09-30',
        purchaseDate: '2026-09-30',
        cardId: card.id,
      },
      '2026-10-25',
    )
    const cuota5 = (await db.expenses.toArray()).find((e) => e.sourcePlanId === plan.id && e.occurrenceIndex === 4)!
    await saveExpenseFromForm(
      {
        date: cuota5.date,
        description: 'Cubiertas (cuota 5/6) — Gomerías Neumen',
        categoryId: category.id,
        amount: '88.040',
        currency: 'ARS',
        cardId: card.id,
        statementPeriod: cuota5.statementPeriod!,
      },
      cuota5.id,
    )
    expect(await db.expenses.get(cuota5.id)).toMatchObject({ sourcePlanId: plan.id, occurrenceIndex: 4, status: 'projected' })
    const [item] = await listInstallmentPlansWithProgress('2026-10-25')
    expect(item?.cardProgress?.unbilledCount).toBe(4)
    expect(item?.cardProgress?.unbilled).toEqual(money(4 * 88_040_00, 'ARS'))
  })

  it('without a card there is no statement view: progress stays by date', async () => {
    const { category } = await setup()
    await createInstallmentPlan(
      { description: 'Préstamo', categoryId: category.id, currency: 'ARS', totalAmount: 600, count: 6, firstDueDate: '2026-09-30', purchaseDate: '2026-09-30' },
      '2026-10-25',
    )
    const [item] = await listInstallmentPlansWithProgress('2026-10-25')
    expect(item?.cardProgress).toBeUndefined()
  })
})

describe('cuotas que ya venías pagando (B)', () => {
  afterEach(async () => {
    await Promise.all([db.creditCards.clear(), db.cardStatements.clear()])
  })

  const form = {
    currency: 'ARS',
    totalAmount: '528.240',
    count: '6',
    alreadyPaying: true,
    currentCuotaInOpening: false,
  }

  it('with a card: only the cuotas from the one in today’s statement on, and progress like the bank from day one', async () => {
    const { createCreditCard } = await import('@/database/repositories/creditCards.repo')
    const { createInstallmentPlanFromForm } = await import('./service')
    const { category } = await setup()
    const card = await createCreditCard({ name: 'visa 2551', closingDay: 22, dueDay: 4 })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T12:00:00'))
    try {
      const plan = await createInstallmentPlanFromForm({
        ...form,
        description: 'cubiertas',
        categoryId: category.id,
        firstDueDate: '2026-09-30',
        purchaseDate: '2026-09-30',
        cardId: card.id,
        currentCuota: '2',
      })
      expect(plan.startIndex).toBe(1)
      const cuotas = (await db.expenses.where('sourcePlanId').equals(plan.id).toArray()).sort(
        (a, b) => a.occurrenceIndex! - b.occurrenceIndex!,
      )
      // Cuota 1 (October's statement) isn't generated: paid before Moneta.
      expect(cuotas.map((c) => [c.occurrenceIndex, c.statementPeriod])).toEqual([
        [1, '2026-11'],
        [2, '2026-12'],
        [3, '2027-01'],
        [4, '2027-02'],
        [5, '2027-03'],
      ])
      const [item] = await listInstallmentPlansWithProgress('2026-10-25')
      expect(item?.cardProgress?.stage).toEqual({ kind: 'billing', number: 2, period: '2026-11', inOpenStatement: true })
      expect(item?.cardProgress?.billedCount).toBe(2)
      expect(item?.cardProgress?.unbilled).toEqual(money(4 * 88_040_00, 'ARS'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('without a card: from the next cuota to pay, due on the date given; the earlier ones count as paid', async () => {
    const { createInstallmentPlanFromForm } = await import('./service')
    const { category } = await setup()
    const plan = await createInstallmentPlanFromForm({
      ...form,
      description: 'Préstamo',
      categoryId: category.id,
      firstDueDate: '2026-11-10', // when cuota 3 is due
      purchaseDate: '2026-08-15',
      cardId: '',
      currentCuota: '3',
    })
    // Anchored on the cuota it starts from — dates never derived backwards.
    expect(plan.firstDueDate).toBe('2026-11-10')
    const cuotas = (await db.expenses.where('sourcePlanId').equals(plan.id).toArray()).sort(
      (a, b) => a.occurrenceIndex! - b.occurrenceIndex!,
    )
    expect(cuotas.map((c) => [c.occurrenceIndex, c.date])).toEqual([
      [2, '2026-11-10'],
      [3, '2026-12-10'],
      [4, '2027-01-10'],
      [5, '2027-02-10'],
    ])
    const [item] = await listInstallmentPlansWithProgress('2026-10-25')
    expect(item?.confirmedCount).toBe(2)
    expect(item?.remaining).toEqual(money(4 * 88_040_00, 'ARS'))
  })

  it('never starts past the last cuota', async () => {
    const { category } = await setup()
    await expect(
      createInstallmentPlan({
        description: 'x',
        categoryId: category.id,
        currency: 'ARS',
        totalAmount: 600,
        count: 6,
        firstDueDate: '2026-09-10',
        purchaseDate: '2026-09-10',
        startIndex: 6,
      }),
    ).rejects.toThrow(/entre 1 y 6/)
  })
})

describe('stageDueDate', () => {
  afterEach(async () => {
    await Promise.all([db.creditCards.clear(), db.cardStatements.clear()])
  })

  it('names the statement a card cuota is in by its due date — the corrected one when the bank moved it', async () => {
    const { createCreditCard } = await import('@/database/repositories/creditCards.repo')
    const { setStatementOverride } = await import('@/database/repositories/cardStatements.repo')
    const { category } = await setup()
    const card = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })
    // Bought after October's close: no cuota billed yet, the first goes in November's.
    await createInstallmentPlan(
      { description: 'Valija', categoryId: category.id, currency: 'ARS', totalAmount: 600, count: 6, firstDueDate: '2026-10-30', purchaseDate: '2026-10-30', cardId: card.id },
      '2026-10-20',
    )
    const [upcoming] = await listInstallmentPlansWithProgress('2026-10-20')
    expect(upcoming?.cardProgress?.stage.kind).toBe('upcoming')
    expect(upcoming?.stageDueDate).toBe('2026-12-04')

    await setStatementOverride({ cardId: card.id, period: '2026-11', closeDate: '2026-11-19', dueDate: '2026-12-03' })
    const [billing] = await listInstallmentPlansWithProgress('2026-11-01')
    expect(billing?.cardProgress?.stage.kind).toBe('billing')
    expect(billing?.stageDueDate).toBe('2026-12-03')
  })
})

describe('revisión de B', () => {
  afterEach(async () => {
    await Promise.all([db.creditCards.clear(), db.cardStatements.clear()])
  })

  const base = {
    currency: 'ARS',
    totalAmount: '528.240',
    count: '6',
    alreadyPaying: true,
    currentCuotaInOpening: false,
  }

  it('with a card, a cuota number that doesn’t match the purchase date is rejected — nothing is created', async () => {
    const { createCreditCard } = await import('@/database/repositories/creditCards.repo')
    const { createInstallmentPlanFromForm } = await import('./service')
    const { category } = await setup()
    const card = await createCreditCard({ name: 'visa 2551', closingDay: 22, dueDay: 4 })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T12:00:00'))
    try {
      const values = { ...base, description: 'cubiertas', categoryId: category.id, firstDueDate: '2026-09-30', purchaseDate: '2026-09-30', cardId: card.id }
      await expect(createInstallmentPlanFromForm({ ...values, currentCuota: '3' })).rejects.toThrow(/es la 2, no la 3/)
      await expect(createInstallmentPlanFromForm({ ...values, currentCuota: '1' })).rejects.toThrow(/es la 2, no la 1/)
      await expect(
        createInstallmentPlanFromForm({ ...values, purchaseDate: '2026-11-25', firstDueDate: '2026-11-25', currentCuota: '1' }),
      ).rejects.toThrow(/todavía no entró/)
      expect(await db.installmentPlans.count()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cuota already inside the open statement’s opening balance isn’t generated again', async () => {
    const { createInstallmentPlanFromForm } = await import('./service')
    const { createCardFromForm } = await import('@/features/cards/service')
    const { category } = await setup()
    const card = await createCardFromForm(
      {
        name: 'visa 2551',
        closingDay: '22',
        dueDay: '4',
        closingDayToNext: false,
        openingClosedArs: '',
        openingClosedUsd: '',
        openingOpenArs: '150.000',
        openingOpenUsd: '',
        notes: '',
      },
      '2026-10-25',
    )
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T12:00:00'))
    try {
      const plan = await createInstallmentPlanFromForm({
        ...base,
        description: 'cubiertas',
        categoryId: category.id,
        firstDueDate: '2026-09-30',
        purchaseDate: '2026-09-30',
        cardId: card.id,
        currentCuota: '2',
        currentCuotaInOpening: true,
      })
      expect(plan.startIndex).toBe(2)
      const periods = (await db.expenses.where('sourcePlanId').equals(plan.id).toArray()).map((e) => e.statementPeriod).sort()
      expect(periods[0]).toBe('2026-12') // November's cuota is in the opening balance
    } finally {
      vi.useRealTimers()
    }
  })

  it('without a card, a cuota due on the 31st stays on the 31st (no backwards-and-forwards drift)', async () => {
    const { createInstallmentPlanFromForm } = await import('./service')
    const { category } = await setup()
    const plan = await createInstallmentPlanFromForm({
      ...base,
      count: '4',
      description: 'Préstamo',
      categoryId: category.id,
      firstDueDate: '2027-03-31',
      purchaseDate: '2027-01-15',
      cardId: '',
      currentCuota: '2',
    })
    const dates = (await db.expenses.where('sourcePlanId').equals(plan.id).toArray()).map((e) => e.date).sort()
    expect(dates).toEqual(['2027-03-31', '2027-04-30', '2027-05-31'])
  })

  it('a total that doesn’t divide evenly: the generated cuotas and what remains still add up to it', async () => {
    const { category } = await setup()
    const plan = await createInstallmentPlan(
      { description: 'x', categoryId: category.id, currency: 'ARS', totalAmount: 100_00, count: 3, firstDueDate: '2099-01-10', purchaseDate: '2026-10-01', startIndex: 1 },
      '2026-10-25',
    )
    const amounts = (await db.expenses.where('sourcePlanId').equals(plan.id).toArray()).map((e) => e.amount).sort()
    expect(amounts).toEqual([33_33, 33_33])
    const [item] = await listInstallmentPlansWithProgress('2026-10-25')
    // 33,34 (cuota 1, paid before Moneta) + 33,33 + 33,33 = 100,00.
    expect(item?.remaining).toEqual(money(66_66, 'ARS'))
  })

  it('toggling the closing-day option is rejected when it would shift a plan loaded mid-way', async () => {
    const { createCreditCard, updateCreditCard } = await import('@/database/repositories/creditCards.repo')
    const { category } = await setup()
    const card = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-25T12:00:00'))
    try {
      // Bought ON a closing day (Sep 22): the option moves its first statement.
      await createInstallmentPlan(
        { description: 'Mesa', categoryId: category.id, currency: 'ARS', totalAmount: 600, count: 6, firstDueDate: '2026-09-22', purchaseDate: '2026-09-22', cardId: card.id, startIndex: 2 },
        '2026-11-25',
      )
      await expect(
        updateCreditCard(card.id, { name: 'visa', closingDay: 22, dueDay: 4, closingDayToNext: true, notes: undefined }),
      ).rejects.toThrow(/a mitad de camino/)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ingreso fijo (sueldo)', () => {
  afterEach(async () => {
    await Promise.all([db.incomes.clear(), db.creditCards.clear()])
  })

  async function salarySetup() {
    const sueldo = await createCategory({ kind: 'income', name: 'Sueldo' })
    const values = {
      kind: 'income' as const,
      description: 'Sueldo',
      categoryId: sueldo.id,
      currency: 'ARS',
      amount: '1.500.000',
      freq: 'monthly' as const,
      interval: '1',
      dayOfMonth: '1',
      startDate: '2026-10-01',
      endDate: '',
      maxOccurrences: '',
      paymentMethod: '',
    }
    return { sueldo, values }
  }

  it('generates an ingreso (with no account) each time it’s due, listed as income', async () => {
    const { values } = await salarySetup()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T12:00:00'))
    try {
      const plan = await createRecurringPlanFromForm(values)
      expect(plan.kind).toBe('income')
      const incomes = (await db.incomes.toArray()).sort((a, b) => a.date.localeCompare(b.date))
      expect(incomes.map((i) => [i.date, i.amount, i.sourcePlanId])).toEqual([
        ['2026-10-01', 1_500_000_00, plan.id],
        ['2026-11-01', 1_500_000_00, plan.id],
      ])
      for (const income of incomes) expect(income).not.toHaveProperty('accountId')
      expect(await db.expenses.count()).toBe(0)
      const { listRecurringPlansWithNext } = await import('./service')
      const [item] = await listRecurringPlansWithNext()
      expect(item).toMatchObject({ kind: 'income', generatedCount: 2 })
      expect(item).not.toHaveProperty('paymentLabel')
    } finally {
      vi.useRealTimers()
    }
  })

  it('“borrar también” removes the ingresos it generated', async () => {
    const { values } = await salarySetup()
    const plan = await createRecurringPlanFromForm(values)
    const { removeRecurringPlan } = await import('./service')
    await removeRecurringPlan(plan.id, { deleteGeneratedExpenses: true })
    expect(await db.incomes.count()).toBe(0)
  })

  it('needs no account but an income category; never a card; never turned into a gasto', async () => {
    const { sueldo, values } = await salarySetup()
    const gasto = await createCategory({ kind: 'expense', name: 'Comida' })
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-10-01' }
    const template = { description: 'Sueldo', categoryId: sueldo.id, amount: 100, currency: 'ARS' }
    await expect(createRecurringPlan({ kind: 'income', template: { ...template, categoryId: gasto.id }, rule })).rejects.toThrow(/categoría de ingreso/)
    await expect(createRecurringPlan({ kind: 'income', template: { ...template, cardId: 'c1' }, rule })).rejects.toThrow(/tarjeta/)
    await expect(createRecurringPlan({ kind: 'income', template, rule })).resolves.toMatchObject({ kind: 'income' })
    const plan = await createRecurringPlanFromForm(values)
    await expect(updateRecurringPlanFromForm(plan.id, { ...values, kind: 'expense' })).rejects.toThrow(/no se puede convertir/)
  })

  it('a salary to come isn’t committed spend in a budget', async () => {
    const { values } = await salarySetup()
    await createRecurringPlanFromForm({ ...values, startDate: '2099-01-01' })
    const { getSpentAndCommittedByCategoryInRange } = await import('@/features/reports/service')
    const { committed } = await getSpentAndCommittedByCategoryInRange('2099-01-01', '2099-01-31')
    expect(committed.items).toEqual([])
  })
})

describe('getCuotaTimeline', () => {
  afterEach(async () => {
    await Promise.all([db.creditCards.clear(), db.cardStatements.clear()])
  })

  it('a card cuota counts when its statement is due, any other on its date; free the month after the last', async () => {
    const category = await createCategory({ kind: 'expense', name: 'Hogar' })
    const visa = await createCreditCard({ name: 'Visa', closingDay: 22, dueDay: 4 })
    // Statements of Oct, Nov and Dec: due Nov 4, Dec 4 and Jan 4.
    await createInstallmentPlan(
      { description: 'Heladera', categoryId: category.id, currency: 'ARS', totalAmount: 300_00, count: 3, firstDueDate: '2026-10-10', purchaseDate: '2026-10-10', cardId: visa.id },
      '2026-10-10',
    )
    await createInstallmentPlan(
      { description: 'Préstamo', categoryId: category.id, currency: 'ARS', totalAmount: 100_00, count: 2, firstDueDate: '2026-11-15', purchaseDate: '2026-11-01' },
      '2026-11-01',
    )

    const timeline = await getCuotaTimeline('2026-11-02')
    expect(timeline.freeFrom).toBe('2027-02')
    expect(timeline.months).toEqual([
      { month: '2026-11', totals: [money(150_00, 'ARS')], share: 1, ending: [] },
      { month: '2026-12', totals: [money(150_00, 'ARS')], share: 1, ending: ['Préstamo'] },
      { month: '2027-01', totals: [money(100_00, 'ARS')], share: 100_00 / 150_00, ending: ['Heladera'] },
    ])
  })

  it("only installment plans' gastos; a cuota moved to another statement counts when that one is due; no rate, no bar", async () => {
    const category = await createCategory({ kind: 'expense', name: 'Hogar' })
    const visa = await createCreditCard({ name: 'Visa', closingDay: 22, dueDay: 4 })
    const tele = await createInstallmentPlan(
      { description: 'Tele', categoryId: category.id, currency: 'ARS', totalAmount: 200_00, count: 2, firstDueDate: '2026-11-10', purchaseDate: '2026-11-01' },
      '2026-11-01',
    )
    await createInstallmentPlan(
      { description: 'Curso', categoryId: category.id, currency: 'USD', totalAmount: 50_00, count: 1, firstDueDate: '2026-11-20', purchaseDate: '2026-11-01' },
      '2026-11-01',
    )
    // A fixed gasto paid by card, generated: not a cuota.
    const netflix = await createRecurringPlan({
      template: { description: 'Netflix', categoryId: category.id, amount: 15_00, currency: 'ARS', cardId: visa.id },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-11-01' },
    })
    await db.expenses.add({
      id: generateId(), date: '2026-11-01', description: 'Netflix', categoryId: category.id, amount: 15_00, currency: 'ARS',
      status: 'confirmed', sourcePlanId: netflix.id, occurrenceIndex: 0, cardId: visa.id, statementPeriod: '2026-11',
      createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    })
    // The Tele's first cuota, put by hand on the card's November statement (due Dec 4).
    const first = (await db.expenses.where('sourcePlanId').equals(tele.id).sortBy('date'))[0]
    await db.expenses.update(first?.id ?? '', { cardId: visa.id, statementPeriod: '2026-11' })

    const timeline = await getCuotaTimeline('2026-11-02')
    expect(timeline.months).toEqual([
      { month: '2026-11', totals: [money(50_00, 'USD')], share: 0, ending: ['Curso'] },
      { month: '2026-12', totals: [money(200_00, 'ARS')], share: 1, ending: ['Tele'] },
    ])
  })

  it('with no cuotas ahead there is nothing to show', async () => {
    expect(await getCuotaTimeline('2026-11-02')).toEqual({ from: '2026-11', months: [], freeFrom: undefined })
  })
})
