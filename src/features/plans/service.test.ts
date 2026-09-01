import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createAccount, listAccountsWithBalances } from '@/database/repositories/accounts.repo'
import { mergeAllTables } from '@/database/repositories/backup.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { createRecurringPlan, listRecurringPlans, setRecurringPlanPaused } from '@/database/repositories/recurringPlans.repo'
import { createInstallmentPlan } from '@/database/repositories/installmentPlans.repo'
import { generateId } from '@/lib/ids'
import { minor } from '@/domain/money'
import type { RecurrenceRule, TransactionTemplate } from '@/domain/entities'
import {
  createRecurringPlanFromForm,
  listInstallmentPlansWithProgress,
  listRecurringPlansWithNext,
  materializeDue,
  removeRecurringPlan,
  updateInstallmentPlanFromForm,
  updateRecurringPlanFromForm,
} from './service'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
    db.recurringPlans.clear(),
    db.installmentPlans.clear(),
  ])
})

async function setup() {
  const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
  const category = await createCategory({ name: 'Alquiler', kind: 'expense' })
  return { account, category }
}

function template(accountId: string, categoryId: string): TransactionTemplate {
  return { description: 'Alquiler', kind: 'expense', accountId, categoryId, amount: 100_000, currency: 'ARS' }
}

describe('materializeDue — recurring plans', () => {
  it('materializes only what is due as of today, nothing more', async () => {
    const { account, category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    await createRecurringPlan({ template: template(account.id, category.id), rule })

    const { recurringCreated } = await materializeDue('2026-08-15')
    expect(recurringCreated).toBe(3) // Jun, Jul, Aug

    const created = await db.transactions.where('kind').equals('expense').toArray()
    expect(created.map((t) => t.date).sort()).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
    expect(created.every((t) => t.status === 'confirmed')).toBe(true)
  })

  it('running twice in a row does not duplicate anything', async () => {
    const { account, category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    await createRecurringPlan({ template: template(account.id, category.id), rule })

    await materializeDue('2026-08-15')
    const second = await materializeDue('2026-08-15')
    expect(second.recurringCreated).toBe(0)

    const created = await db.transactions.toArray()
    expect(created).toHaveLength(3)
  })

  it('a later call only materializes the newly-due occurrences', async () => {
    const { account, category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    await createRecurringPlan({ template: template(account.id, category.id), rule })

    await materializeDue('2026-06-15') // only June due
    const second = await materializeDue('2026-08-15') // July + August newly due
    expect(second.recurringCreated).toBe(2)

    const created = await db.transactions.toArray()
    expect(created).toHaveLength(3)
  })

  it('a paused plan materializes nothing', async () => {
    const { account, category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-06-01' }
    const plan = await createRecurringPlan({ template: template(account.id, category.id), rule })
    await setRecurringPlanPaused(plan.id, true)

    const { recurringCreated } = await materializeDue('2026-08-15')
    expect(recurringCreated).toBe(0)
    expect(await db.transactions.toArray()).toEqual([])
  })

  it('a plan whose endDate already passed materializes nothing new', async () => {
    const { account, category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-01-01', endDate: '2026-03-01' }
    await createRecurringPlan({ template: template(account.id, category.id), rule })

    await materializeDue('2026-03-15') // catches up through the endDate
    const { recurringCreated } = await materializeDue('2026-08-15') // nothing left to generate
    expect(recurringCreated).toBe(0)
    expect(await db.transactions.toArray()).toHaveLength(3) // Jan, Feb, Mar only
  })
})

describe('materializeDue — installment cuotas', () => {
  it('promotes a due projected cuota to confirmed, and only then moves the account balance', async () => {
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
      '2026-07-20', // "today" at creation time — every cuota is still projected
    )

    const [beforeAccount] = await listAccountsWithBalances()
    expect(beforeAccount?.balance).toBe(0)

    const { installmentsConfirmed } = await materializeDue('2026-08-01')
    expect(installmentsConfirmed).toBe(1) // only the first cuota is due

    const [afterAccount] = await listAccountsWithBalances()
    expect(afterAccount?.balance).toBe(-3_000)
  })

  it('running twice in a row does not re-confirm or duplicate anything', async () => {
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
      '2026-07-20',
    )

    await materializeDue('2026-10-01') // all 3 cuotas due
    const second = await materializeDue('2026-10-01')
    expect(second.installmentsConfirmed).toBe(0)

    const [finalAccount] = await listAccountsWithBalances()
    expect(finalAccount?.balance).toBe(-9_000) // not -18_000
  })
})

describe('createRecurringPlanFromForm', () => {
  it('rejects a transfer between accounts of different currencies', async () => {
    const ars = await createAccount({ name: 'Banco ARS', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const usd = await createAccount({ name: 'Banco USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })

    await expect(
      createRecurringPlanFromForm({
        description: 'Ahorro',
        kind: 'transfer',
        accountId: ars.id,
        categoryId: '',
        toAccountId: usd.id,
        amount: '1000',
        freq: 'monthly',
        interval: '1',
        dayOfMonth: '',
        startDate: '2026-01-01',
        endDate: '',
        maxOccurrences: '',
      }),
    ).rejects.toThrow(/distinta moneda/)
    expect(await listRecurringPlans()).toEqual([])
  })

  it('accepts a same-currency transfer and materializes it on both accounts', async () => {
    const from = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const to = await createAccount({ name: 'Ahorros', type: 'bank', currency: 'ARS', openingBalance: minor(0) })

    await createRecurringPlanFromForm({
      description: 'Ahorro',
      kind: 'transfer',
      accountId: from.id,
      categoryId: '',
      toAccountId: to.id,
      amount: '10000',
      freq: 'monthly',
      interval: '1',
      dayOfMonth: '',
      startDate: '2026-06-01',
      endDate: '',
      maxOccurrences: '',
    })

    const { recurringCreated } = await materializeDue('2026-06-15')
    expect(recurringCreated).toBe(1)

    const accounts = await listAccountsWithBalances()
    expect(accounts.find((a) => a.id === from.id)?.balance).toBe(-1_000_000)
    expect(accounts.find((a) => a.id === to.id)?.balance).toBe(1_000_000)
  })
})

describe('updateRecurringPlanFromForm', () => {
  it('only affects occurrences materialized after the edit, never the ones already generated', async () => {
    const { account, category } = await setup()
    await createRecurringPlanFromForm({
      description: 'Alquiler',
      kind: 'expense',
      accountId: account.id,
      categoryId: category.id,
      toAccountId: '',
      amount: '1000',
      freq: 'monthly',
      interval: '1',
      dayOfMonth: '',
      startDate: '2026-01-01',
      endDate: '',
      maxOccurrences: '',
    })
    const [plan] = await listRecurringPlans()
    await materializeDue('2026-02-15') // Jan + Feb at the old amount

    await updateRecurringPlanFromForm(plan!.id, {
      description: 'Alquiler nuevo',
      kind: 'expense',
      accountId: account.id,
      categoryId: category.id,
      toAccountId: '',
      amount: '2000',
      freq: 'monthly',
      interval: '1',
      dayOfMonth: '',
      startDate: '2026-01-01',
      endDate: '',
      maxOccurrences: '',
    })
    await materializeDue('2026-03-15') // March, at the new amount

    const postings = await db.postings.where('accountId').equals(account.id).toArray()
    expect(postings.map((p) => p.amount).sort((a, b) => a - b)).toEqual([-200_000, -100_000, -100_000])
    const transactions = await db.transactions.orderBy('date').toArray()
    expect(transactions.map((t) => t.description)).toEqual(['Alquiler', 'Alquiler', 'Alquiler nuevo'])
  })

  it('rejects editing into a transfer between accounts of different currencies', async () => {
    const { account, category } = await setup()
    const usd = await createAccount({ name: 'USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })
    await createRecurringPlanFromForm({
      description: 'Alquiler',
      kind: 'expense',
      accountId: account.id,
      categoryId: category.id,
      toAccountId: '',
      amount: '1000',
      freq: 'monthly',
      interval: '1',
      dayOfMonth: '',
      startDate: '2026-01-01',
      endDate: '',
      maxOccurrences: '',
    })
    const [plan] = await listRecurringPlans()

    await expect(
      updateRecurringPlanFromForm(plan!.id, {
        description: 'Alquiler',
        kind: 'transfer',
        accountId: account.id,
        categoryId: '',
        toAccountId: usd.id,
        amount: '1000',
        freq: 'monthly',
        interval: '1',
        dayOfMonth: '',
        startDate: '2026-01-01',
        endDate: '',
        maxOccurrences: '',
      }),
    ).rejects.toThrow(/distinta moneda/)

    // Rejected before the write — the plan's original template survives untouched.
    const [unchanged] = await listRecurringPlans()
    expect(unchanged?.template.kind).toBe('expense')
  })
})

describe('updateInstallmentPlanFromForm', () => {
  it('rewrites still-projected cuotas in place, leaving confirmed ones untouched', async () => {
    const { account, category } = await setup()
    const otherCategory = await createCategory({ name: 'Tecnología', kind: 'expense' })
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
      '2026-08-15', // first cuota (Aug) is already due -> confirmed; Sep/Oct stay projected
    )

    await updateInstallmentPlanFromForm(plan.id, {
      description: 'Notebook nueva',
      accountId: account.id,
      categoryId: otherCategory.id,
    })

    const transactions = await db.transactions.where('sourcePlanId').equals(plan.id).sortBy('date')
    expect(transactions.map((t) => ({ status: t.status, description: t.description }))).toEqual([
      { status: 'confirmed', description: 'Notebook (cuota 1/3)' },
      { status: 'projected', description: 'Notebook nueva (cuota 2/3)' },
      { status: 'projected', description: 'Notebook nueva (cuota 3/3)' },
    ])

    const postings = await db.postings
      .where('transactionId')
      .anyOf(transactions.map((t) => t.id))
      .and((p) => p.target === 'category')
      .toArray()
    const categoryIdByTransaction = new Map(postings.map((p) => [p.transactionId, p.categoryId]))
    expect(categoryIdByTransaction.get(transactions[0]!.id)).toBe(category.id) // confirmed: untouched
    expect(categoryIdByTransaction.get(transactions[1]!.id)).toBe(otherCategory.id) // projected: updated
  })

  it('rejects moving the plan to an account of a different currency', async () => {
    const { account, category } = await setup()
    const usd = await createAccount({ name: 'USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })
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
      '2026-07-20',
    )

    await expect(
      updateInstallmentPlanFromForm(plan.id, { description: 'Notebook', accountId: usd.id, categoryId: category.id }),
    ).rejects.toThrow(/otra moneda/)
  })
})

describe('materializeDue — isolates a broken plan', () => {
  it('a plan that fails to materialize does not block the others or the cuota sweep', async () => {
    const { account, category } = await setup()
    const usdAccount = await createAccount({ name: 'USD', type: 'bank', currency: 'USD', openingBalance: minor(0) })

    // Only reachable today via a hand-edited backup import — the repo
    // itself doesn't validate currency match, only the form-level service
    // (createRecurringPlanFromForm) does. Constructed directly here to
    // exercise the isolation guard in materializeDue.
    const brokenTemplate: TransactionTemplate = {
      description: 'Roto',
      kind: 'transfer',
      accountId: account.id,
      toAccountId: usdAccount.id,
      amount: 1_000,
      currency: 'ARS',
    }
    await createRecurringPlan({
      template: brokenTemplate,
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
    })
    await createRecurringPlan({
      template: template(account.id, category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })
    await createInstallmentPlan(
      { description: 'Notebook', accountId: account.id, categoryId: category.id, currency: 'ARS', totalAmount: 3_000, count: 1, firstDueDate: '2026-08-01', purchaseDate: '2026-07-15' },
      '2026-07-20',
    )

    const summary = await materializeDue('2026-08-15')
    expect(summary.failedPlanIds).toHaveLength(1)
    expect(summary.recurringCreated).toBe(3) // the healthy plan: Jun, Jul, Aug
    expect(summary.installmentsConfirmed).toBe(1) // the sweep still ran
  })
})

describe('listRecurringPlansWithNext / listInstallmentPlansWithProgress — orphaned references', () => {
  it('falls back to placeholders when the account or category was hard-deleted', async () => {
    const { account, category } = await setup()
    const recurringPlan = await createRecurringPlan({
      template: template(account.id, category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
    })
    const installmentPlan = await createInstallmentPlan(
      { description: 'Notebook', accountId: account.id, categoryId: category.id, currency: 'ARS', totalAmount: 3_000, count: 1, firstDueDate: '2099-01-01', purchaseDate: '2026-07-15' },
      '2026-07-20',
    )

    // Simulate orphaned references (categories/accounts are normally only
    // archived, never hard-deleted, by production code — see
    // categories.repo.ts — but a corrupted/hand-edited backup import could
    // still leave one dangling).
    await db.accounts.delete(account.id)
    await db.categories.delete(category.id)

    const [recurringItem] = await listRecurringPlansWithNext()
    expect(recurringItem?.id).toBe(recurringPlan.id)
    expect(recurringItem?.accountLabel).toBe('—')
    expect(recurringItem?.categoryLabel).toBe('—')

    const [installmentItem] = await listInstallmentPlansWithProgress()
    expect(installmentItem?.id).toBe(installmentPlan.id)
    expect(installmentItem?.accountLabel).toBe('—')
    expect(installmentItem?.categoryLabel).toBe('Categoría eliminada')
  })
})

describe('listRecurringPlansWithNext — generatedCount', () => {
  it('counts how many transactions a plan has already generated', async () => {
    const { account, category } = await setup()
    await createRecurringPlan({
      template: template(account.id, category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })
    await materializeDue('2026-08-15') // Jun, Jul, Aug -> 3 transactions

    const [item] = await listRecurringPlansWithNext()
    expect(item?.generatedCount).toBe(3)
  })

  it('is zero for a plan that has not materialized anything yet', async () => {
    const { account, category } = await setup()
    await createRecurringPlan({
      template: template(account.id, category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })

    const [item] = await listRecurringPlansWithNext()
    expect(item?.generatedCount).toBe(0)
  })
})

describe('removeRecurringPlan', () => {
  it('erases generated transactions when deleteGeneratedTransactions is true', async () => {
    const { account, category } = await setup()
    const plan = await createRecurringPlan({
      template: template(account.id, category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })
    await materializeDue('2026-08-15')
    expect(await db.transactions.where('sourcePlanId').equals(plan.id).count()).toBe(3)

    await removeRecurringPlan(plan.id, { deleteGeneratedTransactions: true })

    expect(await listRecurringPlans()).toEqual([])
    expect(await db.transactions.where('sourcePlanId').equals(plan.id).count()).toBe(0)
  })

  it('keeps generated transactions by default', async () => {
    const { account, category } = await setup()
    const plan = await createRecurringPlan({
      template: template(account.id, category.id),
      rule: { freq: 'monthly', interval: 1, startDate: '2026-06-01' },
    })
    await materializeDue('2026-08-15')

    await removeRecurringPlan(plan.id)

    expect(await db.transactions.where('sourcePlanId').equals(plan.id).count()).toBe(3)
  })
})

describe('materializeDue after a backup merge', () => {
  it('does not re-materialize occurrences merged in from another device', async () => {
    const { account, category } = await setup()
    const rule: RecurrenceRule = { freq: 'monthly', interval: 1, startDate: '2026-01-01' }
    const plan = await createRecurringPlan({ template: template(account.id, category.id), rule })
    await db.recurringPlans.update(plan.id, { lastMaterializedDate: '2026-01-01' })
    await db.transactions.add({
      id: generateId(),
      date: '2026-01-01',
      kind: 'expense',
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
      accounts: [],
      categories: [],
      transactions: [
        {
          id: generateId(),
          date: '2026-02-01',
          kind: 'expense',
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
          kind: 'expense',
          description: 'Alquiler',
          status: 'confirmed',
          sourcePlanId: plan.id,
          occurrenceIndex: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      postings: [],
      recurringPlans: [],
      installmentPlans: [],
      budgets: [],
      exchangeRates: [],
      savingsHoldings: [],
      investmentAssets: [],
      investmentHoldings: [],
      assetPrices: [],
    })

    // Without the watermark repair in mergeAllTables, lastMaterializedDate
    // would still be the pre-merge 2026-01-01, and this would treat
    // 2026-02-01/2026-03-01 as still due, duplicating both.
    const { recurringCreated } = await materializeDue('2026-03-15')
    expect(recurringCreated).toBe(0)

    const planTransactions = await db.transactions.where('sourcePlanId').equals(plan.id).toArray()
    expect(planTransactions.map((t) => t.date).sort()).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
})
