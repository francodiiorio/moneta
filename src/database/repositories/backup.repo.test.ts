import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { generateId } from '@/lib/ids'
import { createCategory } from './categories.repo'
import { mergeAllTables, readAllTables, type AllTablesData } from './backup.repo'
import type { Category, Expense, RecurringPlan, Settings } from '@/domain/entities'

afterEach(async () => {
  await Promise.all([
    db.categories.clear(),
    db.expenses.clear(),
    db.recurringPlans.clear(),
    db.installmentPlans.clear(),
    db.budgets.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
    db.investmentLots.clear(),
  ])
})

function emptyData(overrides: Partial<AllTablesData> = {}): AllTablesData {
  return {
    categories: [],
    expenses: [],
    recurringPlans: [],
    installmentPlans: [],
    budgets: [],
    exchangeRates: [],
    savingsHoldings: [],
    investmentAssets: [],
    investmentHoldings: [],
    assetPrices: [],
    investmentLots: [],
    ...overrides,
  }
}

function category(overrides: Partial<Category> = {}): Category {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    name: 'Categoría',
    order: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function expense(overrides: Partial<Expense> = {}): Expense {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    date: '2026-01-01',
    amount: 100,
    currency: 'ARS',
    categoryId: generateId(),
    description: 'Gasto',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('mergeAllTables', () => {
  it('adds a disjoint dataset entirely', async () => {
    const localCategory = await createCategory({ name: 'Local' })

    const incomingExpense = expense({ description: 'Remoto' })
    const incomingCategory = category({ name: 'Remoto' })

    const summary = await mergeAllTables(emptyData({ expenses: [incomingExpense], categories: [incomingCategory] }))

    expect(summary.expenses).toEqual({ added: 1, skipped: 0 })
    expect(summary.categories).toEqual({ added: 1, skipped: 0 })
    const expenseIds = (await db.expenses.toArray()).map((e) => e.id).sort()
    expect(expenseIds).toEqual([incomingExpense.id].sort())
    const categoryIds = (await db.categories.toArray()).map((c) => c.id).sort()
    expect(categoryIds).toEqual([localCategory.id, incomingCategory.id].sort())
  })

  it('never overwrites an entity that already exists locally, even with different content', async () => {
    const local = await createCategory({ name: 'Nombre original' })
    const collidingCopy = category({ ...local, name: 'Nombre del archivo (viejo)' })

    const summary = await mergeAllTables(emptyData({ categories: [collidingCopy] }))

    expect(summary.categories).toEqual({ added: 0, skipped: 1 })
    const stored = await db.categories.get(local.id)
    expect(stored?.name).toBe('Nombre original')
    expect(await db.categories.count()).toBe(1)
  })

  it('merging the same dataset twice in a row is a no-op the second time', async () => {
    const incoming = emptyData({ expenses: [expense()], categories: [category()] })

    const first = await mergeAllTables(incoming)
    expect(first.expenses).toEqual({ added: 1, skipped: 0 })
    expect(first.categories).toEqual({ added: 1, skipped: 0 })

    const second = await mergeAllTables(incoming)
    expect(second.expenses).toEqual({ added: 0, skipped: 1 })
    expect(second.categories).toEqual({ added: 0, skipped: 1 })
    expect(await db.expenses.count()).toBe(1)
    expect(await db.categories.count()).toBe(1)
  })

  it('ignores settings from the file when local settings already exist', async () => {
    await db.settings.add({
      id: 'singleton',
      baseCurrency: 'ARS',
      locale: 'es-AR',
      firstDayOfMonth: 1,
      theme: 'system',
      schemaVersion: 1,
    })
    const incomingSettings: Settings = {
      id: 'singleton',
      baseCurrency: 'USD',
      locale: 'en-US',
      firstDayOfMonth: 1,
      theme: 'dark',
      schemaVersion: 1,
    }

    await mergeAllTables(emptyData({ settings: incomingSettings }))

    expect((await db.settings.get('singleton'))?.baseCurrency).toBe('ARS')
  })

  it('adds settings from the file when there are none locally yet', async () => {
    const incomingSettings: Settings = {
      id: 'singleton',
      baseCurrency: 'USD',
      locale: 'en-US',
      firstDayOfMonth: 1,
      theme: 'dark',
      schemaVersion: 1,
    }

    await mergeAllTables(emptyData({ settings: incomingSettings }))

    expect((await db.settings.get('singleton'))?.baseCurrency).toBe('USD')
  })

  it('repairs a RecurringPlan watermark to the latest merged-in occurrence date', async () => {
    const cat = await createCategory({ name: 'Alquiler' })
    const now = new Date().toISOString()
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', categoryId: cat.id, amount: 1000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
      lastMaterializedDate: '2026-01-01',
      isPaused: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.recurringPlans.add(plan)
    await db.expenses.add(expense({ description: 'Alquiler', date: '2026-01-01', sourcePlanId: plan.id, occurrenceIndex: 0 }))

    // Another device materialized further ahead before this merge.
    const laterExpense = expense({ description: 'Alquiler', date: '2026-03-01', sourcePlanId: plan.id, occurrenceIndex: 2 })

    await mergeAllTables(emptyData({ expenses: [laterExpense] }))

    const updatedPlan = await db.recurringPlans.get(plan.id)
    expect(updatedPlan?.lastMaterializedDate).toBe('2026-03-01')
  })

  it('does not touch the watermark of a plan with no local expenses after merge', async () => {
    const cat = await createCategory({ name: 'Alquiler' })
    const now = new Date().toISOString()
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', categoryId: cat.id, amount: 1000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
      isPaused: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.recurringPlans.add(plan)

    await mergeAllTables(emptyData({ categories: [category()] }))

    const updatedPlan = await db.recurringPlans.get(plan.id)
    expect(updatedPlan?.lastMaterializedDate).toBeUndefined()
  })

  it('round-trips through readAllTables: merging what was just read changes nothing', async () => {
    await createCategory({ name: 'Comida' })
    const data = await readAllTables()
    const before = await db.categories.count()

    const summary = await mergeAllTables(data)

    expect(summary.categories).toEqual({ added: 0, skipped: 1 })
    expect(await db.categories.count()).toBe(before)
  })

  it('merging a completely empty dataset is a clean no-op', async () => {
    await createCategory({ name: 'Comida' })
    const before = await db.categories.count()

    const summary = await mergeAllTables(emptyData())

    expect(summary).toEqual({
      categories: { added: 0, skipped: 0 },
      expenses: { added: 0, skipped: 0 },
      recurringPlans: { added: 0, skipped: 0 },
      installmentPlans: { added: 0, skipped: 0 },
      budgets: { added: 0, skipped: 0 },
      exchangeRates: { added: 0, skipped: 0 },
      savingsHoldings: { added: 0, skipped: 0 },
      investmentAssets: { added: 0, skipped: 0 },
      investmentHoldings: { added: 0, skipped: 0 },
      assetPrices: { added: 0, skipped: 0 },
      investmentLots: { added: 0, skipped: 0 },
    })
    expect(await db.categories.count()).toBe(before)
  })

  it('repairs the watermark of a RecurringPlan that is itself newly added by the same merge', async () => {
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', categoryId: generateId(), amount: 1000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
      isPaused: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const planExpense = expense({ description: 'Alquiler', date: '2026-02-01', sourcePlanId: plan.id, occurrenceIndex: 1 })

    const summary = await mergeAllTables(emptyData({ recurringPlans: [plan], expenses: [planExpense] }))

    expect(summary.recurringPlans).toEqual({ added: 1, skipped: 0 })
    expect(summary.expenses).toEqual({ added: 1, skipped: 0 })
    expect((await db.recurringPlans.get(plan.id))?.lastMaterializedDate).toBe('2026-02-01')
  })

  it('does not double-count the same RecurringPlan occurrence materialized independently by two devices', async () => {
    // Both "devices" started from the same plan (same id) and each ran
    // materializeDue() on its own afterwards — same sourcePlanId +
    // occurrenceIndex per occurrence, but different expense ids
    // (generateId() is random, not derived from the occurrence).
    const cat = await createCategory({ name: 'Alquiler' })
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', categoryId: cat.id, amount: 100_000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
      lastMaterializedDate: '2026-02-01',
      isPaused: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await db.recurringPlans.add(plan)

    // Local device's own January + February occurrences.
    const localJan = expense({ description: 'Alquiler', date: '2026-01-01', amount: 100_000, categoryId: cat.id, sourcePlanId: plan.id, occurrenceIndex: 0 })
    const localFeb = expense({ description: 'Alquiler', date: '2026-02-01', amount: 100_000, categoryId: cat.id, sourcePlanId: plan.id, occurrenceIndex: 1 })
    await db.expenses.bulkAdd([localJan, localFeb])

    // The "other device"'s backup has its OWN expense ids for the exact
    // same January/February occurrences, plus a genuinely new March.
    const remoteJan = expense({ description: 'Alquiler', date: '2026-01-01', amount: 100_000, categoryId: cat.id, sourcePlanId: plan.id, occurrenceIndex: 0 })
    const remoteFeb = expense({ description: 'Alquiler', date: '2026-02-01', amount: 100_000, categoryId: cat.id, sourcePlanId: plan.id, occurrenceIndex: 1 })
    const remoteMar = expense({ description: 'Alquiler', date: '2026-03-01', amount: 100_000, categoryId: cat.id, sourcePlanId: plan.id, occurrenceIndex: 2 })

    const summary = await mergeAllTables(emptyData({ expenses: [remoteJan, remoteFeb, remoteMar] }))

    // Only March (a genuinely new occurrence) gets added; the duplicate
    // Jan/Feb occurrences from the other device are skipped even though
    // their expense ids don't collide with anything local.
    expect(summary.expenses).toEqual({ added: 1, skipped: 2 })

    const planExpenses = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(planExpenses).toHaveLength(3) // Jan, Feb, Mar — not 5
    expect(planExpenses.map((e) => e.date).sort()).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
    expect(planExpenses.reduce((sum, e) => sum + e.amount, 0)).toBe(300_000) // 3 months, not 5

    expect((await db.recurringPlans.get(plan.id))?.lastMaterializedDate).toBe('2026-03-01')
  })

  it('dedupes the same occurrence even when editing the plan mid-stream gave it a different occurrenceIndex on each device', async () => {
    // Reproduces the scenario updateRecurringPlan's edit makes reachable:
    // both devices materialized Jan/Feb identically (occurrenceIndex 0/1),
    // then device A edited the plan's rule (e.g. moved startDate earlier),
    // which shifts what index generateOccurrences assigns to every
    // occurrence from then on. Device A's March lands as occurrenceIndex 3
    // instead of 2 — same calendar date as what device B (unedited) would
    // produce for its own March, but a different index. Dedup has to key
    // on `date`, not `occurrenceIndex`, or this becomes a real double
    // charge once both backups get merged onto a third device.
    const cat = await createCategory({ name: 'Alquiler' })
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', categoryId: cat.id, amount: 100_000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2025-12-01' }, // already edited locally
      lastMaterializedDate: '2026-02-01',
      isPaused: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await db.recurringPlans.add(plan)

    // This device's own March, materialized under the edited rule — index
    // 3 counting from the new (earlier) startDate.
    const localMar = expense({ description: 'Alquiler', date: '2026-03-01', amount: 100_000, categoryId: cat.id, sourcePlanId: plan.id, occurrenceIndex: 3 })
    await db.expenses.add(localMar)

    // The other device's backup: same March occurrence, but index 2 — it
    // never saw the rule edit.
    const remoteMar = expense({ description: 'Alquiler', date: '2026-03-01', amount: 100_000, categoryId: cat.id, sourcePlanId: plan.id, occurrenceIndex: 2 })

    const summary = await mergeAllTables(emptyData({ expenses: [remoteMar] }))

    expect(summary.expenses).toEqual({ added: 0, skipped: 1 })
    const planExpenses = await db.expenses.where('sourcePlanId').equals(plan.id).toArray()
    expect(planExpenses).toHaveLength(1) // not 2
    expect(planExpenses.reduce((sum, e) => sum + e.amount, 0)).toBe(100_000) // one March, not two
  })

  it('does not add two different expense ids for the same occurrence within a single incoming file', async () => {
    // Only reachable via a corrupted/hand-edited backup — materializeDue()
    // itself never writes the same occurrence twice — but the dedup logic
    // must not depend on a snapshot taken before either candidate is seen.
    const planId = generateId()
    const duplicateA = expense({ description: 'Alquiler', date: '2026-01-01', sourcePlanId: planId, occurrenceIndex: 0 })
    const duplicateB = expense({ description: 'Alquiler', date: '2026-01-01', sourcePlanId: planId, occurrenceIndex: 0 })

    const summary = await mergeAllTables(emptyData({ expenses: [duplicateA, duplicateB] }))

    expect(summary.expenses).toEqual({ added: 1, skipped: 1 })
    const stored = await db.expenses.where('sourcePlanId').equals(planId).toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.id).toBe(duplicateA.id)
  })
})
