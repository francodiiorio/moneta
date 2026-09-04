import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { generateId } from '@/lib/ids'
import { minor } from '@/domain/money'
import { createAccount } from './accounts.repo'
import { createCategory } from './categories.repo'
import { mergeAllTables, readAllTables, type AllTablesData } from './backup.repo'
import type { Account, Category, Posting, RecurringPlan, Settings, Transaction } from '@/domain/entities'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.postings.clear(),
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
    accounts: [],
    categories: [],
    transactions: [],
    postings: [],
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

function account(overrides: Partial<Account> = {}): Account {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    name: 'Cuenta',
    type: 'bank',
    currency: 'ARS',
    openingBalance: minor(0),
    isArchived: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function category(overrides: Partial<Category> = {}): Category {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    name: 'Categoría',
    kind: 'expense',
    order: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    date: '2026-01-01',
    kind: 'expense',
    description: 'Movimiento',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function posting(overrides: Partial<Posting> & { transactionId: string }): Posting {
  return {
    id: generateId(),
    target: 'account',
    amount: -100,
    currency: 'ARS',
    date: '2026-01-01',
    ...overrides,
  }
}

describe('mergeAllTables', () => {
  it('adds a disjoint dataset entirely', async () => {
    const localAccount = await createAccount({ name: 'Local', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const localCategory = await createCategory({ name: 'Local', kind: 'expense' })

    const incomingAccount = account({ name: 'Remoto' })
    const incomingCategory = category({ name: 'Remoto' })

    const summary = await mergeAllTables(
      emptyData({ accounts: [incomingAccount], categories: [incomingCategory] }),
    )

    expect(summary.accounts).toEqual({ added: 1, skipped: 0 })
    expect(summary.categories).toEqual({ added: 1, skipped: 0 })
    const accountIds = (await db.accounts.toArray()).map((a) => a.id).sort()
    expect(accountIds).toEqual([localAccount.id, incomingAccount.id].sort())
    const categoryIds = (await db.categories.toArray()).map((c) => c.id).sort()
    expect(categoryIds).toEqual([localCategory.id, incomingCategory.id].sort())
  })

  it('never overwrites an entity that already exists locally, even with different content', async () => {
    const local = await createAccount({ name: 'Nombre original', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const collidingCopy = account({ ...local, name: 'Nombre del archivo (viejo)' })

    const summary = await mergeAllTables(emptyData({ accounts: [collidingCopy] }))

    expect(summary.accounts).toEqual({ added: 0, skipped: 1 })
    const stored = await db.accounts.get(local.id)
    expect(stored?.name).toBe('Nombre original')
    expect(await db.accounts.count()).toBe(1)
  })

  it('merging the same dataset twice in a row is a no-op the second time', async () => {
    const incoming = emptyData({ accounts: [account()], categories: [category()] })

    const first = await mergeAllTables(incoming)
    expect(first.accounts).toEqual({ added: 1, skipped: 0 })
    expect(first.categories).toEqual({ added: 1, skipped: 0 })

    const second = await mergeAllTables(incoming)
    expect(second.accounts).toEqual({ added: 0, skipped: 1 })
    expect(second.categories).toEqual({ added: 0, skipped: 1 })
    expect(await db.accounts.count()).toBe(1)
    expect(await db.categories.count()).toBe(1)
  })

  it('does not add postings for a transaction that already exists locally (the "edited since backup" case)', async () => {
    const acc = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const cat = await createCategory({ name: 'Comida', kind: 'expense' })
    const tx = transaction({ description: 'Super' })
    await db.transactions.add(tx)
    const currentPostings: Posting[] = [
      posting({ transactionId: tx.id, target: 'account', accountId: acc.id, amount: -500, currency: 'ARS' }),
      posting({ transactionId: tx.id, target: 'category', categoryId: cat.id, amount: 500, currency: 'ARS' }),
    ]
    await db.postings.bulkAdd(currentPostings)

    // The file has the SAME transaction id (unedited-looking) but different
    // (stale) posting ids and a different amount — as if it were exported
    // before a later edit replaced the postings locally.
    const stalePostings: Posting[] = [
      posting({ transactionId: tx.id, target: 'account', accountId: acc.id, amount: -100, currency: 'ARS' }),
      posting({ transactionId: tx.id, target: 'category', categoryId: cat.id, amount: 100, currency: 'ARS' }),
    ]

    const summary = await mergeAllTables(emptyData({ transactions: [tx], postings: stalePostings }))

    expect(summary.transactions).toEqual({ added: 0, skipped: 1 })
    const postingsAfter = await db.postings.where('transactionId').equals(tx.id).toArray()
    expect(postingsAfter.map((p) => p.id).sort()).toEqual(currentPostings.map((p) => p.id).sort())
    expect(postingsAfter.map((p) => p.amount).sort()).toEqual([-500, 500])
  })

  it('adds postings for a transaction that is newly added by the merge', async () => {
    const acc = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const cat = await createCategory({ name: 'Comida', kind: 'expense' })
    const tx = transaction({ description: 'Nuevo' })
    const postings: Posting[] = [
      posting({ transactionId: tx.id, target: 'account', accountId: acc.id, amount: -300, currency: 'ARS' }),
      posting({ transactionId: tx.id, target: 'category', categoryId: cat.id, amount: 300, currency: 'ARS' }),
    ]

    const summary = await mergeAllTables(emptyData({ transactions: [tx], postings }))

    expect(summary.transactions).toEqual({ added: 1, skipped: 0 })
    const stored = await db.postings.where('transactionId').equals(tx.id).toArray()
    expect(stored).toHaveLength(2)
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
    const acc = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const cat = await createCategory({ name: 'Alquiler', kind: 'expense' })
    const now = new Date().toISOString()
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', kind: 'expense', accountId: acc.id, categoryId: cat.id, amount: 1000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
      lastMaterializedDate: '2026-01-01',
      isPaused: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.recurringPlans.add(plan)
    await db.transactions.add(
      transaction({ description: 'Alquiler', date: '2026-01-01', sourcePlanId: plan.id, occurrenceIndex: 0 }),
    )

    // Another device materialized further ahead before this merge.
    const laterTx = transaction({ description: 'Alquiler', date: '2026-03-01', sourcePlanId: plan.id, occurrenceIndex: 2 })

    await mergeAllTables(emptyData({ transactions: [laterTx] }))

    const updatedPlan = await db.recurringPlans.get(plan.id)
    expect(updatedPlan?.lastMaterializedDate).toBe('2026-03-01')
  })

  it('does not touch the watermark of a plan with no local transactions after merge', async () => {
    const acc = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const cat = await createCategory({ name: 'Alquiler', kind: 'expense' })
    const now = new Date().toISOString()
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', kind: 'expense', accountId: acc.id, categoryId: cat.id, amount: 1000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
      isPaused: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.recurringPlans.add(plan)

    await mergeAllTables(emptyData({ accounts: [account()] }))

    const updatedPlan = await db.recurringPlans.get(plan.id)
    expect(updatedPlan?.lastMaterializedDate).toBeUndefined()
  })

  it('round-trips through readAllTables: merging what was just read changes nothing', async () => {
    await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const data = await readAllTables()
    const before = await db.accounts.count()

    const summary = await mergeAllTables(data)

    expect(summary.accounts).toEqual({ added: 0, skipped: 1 })
    expect(await db.accounts.count()).toBe(before)
  })

  it('merging a completely empty dataset is a clean no-op', async () => {
    await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const before = await db.accounts.count()

    const summary = await mergeAllTables(emptyData())

    expect(summary).toEqual({
      accounts: { added: 0, skipped: 0 },
      categories: { added: 0, skipped: 0 },
      transactions: { added: 0, skipped: 0 },
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
    expect(await db.accounts.count()).toBe(before)
  })

  it('repairs the watermark of a RecurringPlan that is itself newly added by the same merge', async () => {
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', kind: 'expense', accountId: generateId(), categoryId: generateId(), amount: 1000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
      isPaused: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const planTx = transaction({ description: 'Alquiler', date: '2026-02-01', sourcePlanId: plan.id, occurrenceIndex: 1 })

    const summary = await mergeAllTables(emptyData({ recurringPlans: [plan], transactions: [planTx] }))

    expect(summary.recurringPlans).toEqual({ added: 1, skipped: 0 })
    expect(summary.transactions).toEqual({ added: 1, skipped: 0 })
    expect((await db.recurringPlans.get(plan.id))?.lastMaterializedDate).toBe('2026-02-01')
  })

  it('does not double-count the same RecurringPlan occurrence materialized independently by two devices', async () => {
    // Both "devices" started from the same plan (same id) and each ran
    // materializeDue() on its own afterwards — same sourcePlanId +
    // occurrenceIndex per occurrence, but different transaction ids
    // (generateId() is random, not derived from the occurrence).
    const acc = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const cat = await createCategory({ name: 'Alquiler', kind: 'expense' })
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', kind: 'expense', accountId: acc.id, categoryId: cat.id, amount: 100_000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2026-01-01' },
      lastMaterializedDate: '2026-02-01',
      isPaused: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await db.recurringPlans.add(plan)

    function occurrencePosting(transactionId: string, amount: number): Posting[] {
      return [
        posting({ transactionId, target: 'account', accountId: acc.id, amount: -amount, currency: 'ARS' }),
        posting({ transactionId, target: 'category', categoryId: cat.id, amount, currency: 'ARS' }),
      ]
    }

    // Local device's own January + February occurrences.
    const localJan = transaction({ description: 'Alquiler', date: '2026-01-01', sourcePlanId: plan.id, occurrenceIndex: 0 })
    const localFeb = transaction({ description: 'Alquiler', date: '2026-02-01', sourcePlanId: plan.id, occurrenceIndex: 1 })
    await db.transactions.bulkAdd([localJan, localFeb])
    await db.postings.bulkAdd([...occurrencePosting(localJan.id, 100_000), ...occurrencePosting(localFeb.id, 100_000)])

    // The "other device"'s backup has its OWN transaction ids for the
    // exact same January/February occurrences, plus a genuinely new March.
    const remoteJan = transaction({ description: 'Alquiler', date: '2026-01-01', sourcePlanId: plan.id, occurrenceIndex: 0 })
    const remoteFeb = transaction({ description: 'Alquiler', date: '2026-02-01', sourcePlanId: plan.id, occurrenceIndex: 1 })
    const remoteMar = transaction({ description: 'Alquiler', date: '2026-03-01', sourcePlanId: plan.id, occurrenceIndex: 2 })
    const remotePostings = [
      ...occurrencePosting(remoteJan.id, 100_000),
      ...occurrencePosting(remoteFeb.id, 100_000),
      ...occurrencePosting(remoteMar.id, 100_000),
    ]

    const summary = await mergeAllTables(
      emptyData({ transactions: [remoteJan, remoteFeb, remoteMar], postings: remotePostings }),
    )

    // Only March (a genuinely new occurrence) gets added; the duplicate
    // Jan/Feb occurrences from the other device are skipped even though
    // their transaction ids don't collide with anything local.
    expect(summary.transactions).toEqual({ added: 1, skipped: 2 })

    const planTransactions = await db.transactions.where('sourcePlanId').equals(plan.id).toArray()
    expect(planTransactions).toHaveLength(3) // Jan, Feb, Mar — not 5
    expect(planTransactions.map((t) => t.date).sort()).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])

    const balance = (await db.postings.toArray())
      .filter((p) => p.accountId === acc.id)
      .reduce((sum, p) => sum + p.amount, 0)
    expect(balance).toBe(-300_000) // 3 months, not 5

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
    const acc = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(0) })
    const cat = await createCategory({ name: 'Alquiler', kind: 'expense' })
    const plan: RecurringPlan = {
      id: generateId(),
      template: { description: 'Alquiler', kind: 'expense', accountId: acc.id, categoryId: cat.id, amount: 100_000, currency: 'ARS' },
      rule: { freq: 'monthly', interval: 1, startDate: '2025-12-01' }, // already edited locally
      lastMaterializedDate: '2026-02-01',
      isPaused: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await db.recurringPlans.add(plan)

    // This device's own March, materialized under the edited rule — index
    // 3 counting from the new (earlier) startDate.
    const localMar = transaction({ description: 'Alquiler', date: '2026-03-01', sourcePlanId: plan.id, occurrenceIndex: 3 })
    await db.transactions.add(localMar)
    await db.postings.bulkAdd([
      posting({ transactionId: localMar.id, target: 'account', accountId: acc.id, amount: -100_000, currency: 'ARS' }),
      posting({ transactionId: localMar.id, target: 'category', categoryId: cat.id, amount: 100_000, currency: 'ARS' }),
    ])

    // The other device's backup: same March occurrence, but index 2 — it
    // never saw the rule edit.
    const remoteMar = transaction({ description: 'Alquiler', date: '2026-03-01', sourcePlanId: plan.id, occurrenceIndex: 2 })
    const remotePostings = [
      posting({ transactionId: remoteMar.id, target: 'account', accountId: acc.id, amount: -100_000, currency: 'ARS' }),
      posting({ transactionId: remoteMar.id, target: 'category', categoryId: cat.id, amount: 100_000, currency: 'ARS' }),
    ]

    const summary = await mergeAllTables(emptyData({ transactions: [remoteMar], postings: remotePostings }))

    expect(summary.transactions).toEqual({ added: 0, skipped: 1 })
    const planTransactions = await db.transactions.where('sourcePlanId').equals(plan.id).toArray()
    expect(planTransactions).toHaveLength(1) // not 2

    const balance = (await db.postings.toArray())
      .filter((p) => p.accountId === acc.id)
      .reduce((sum, p) => sum + p.amount, 0)
    expect(balance).toBe(-100_000) // one March, not two
  })

  it('does not add two different transaction ids for the same occurrence within a single incoming file', async () => {
    // Only reachable via a corrupted/hand-edited backup — materializeDue()
    // itself never writes the same occurrence twice — but the dedup logic
    // must not depend on a snapshot taken before either candidate is seen.
    const planId = generateId()
    const duplicateA = transaction({ description: 'Alquiler', date: '2026-01-01', sourcePlanId: planId, occurrenceIndex: 0 })
    const duplicateB = transaction({ description: 'Alquiler', date: '2026-01-01', sourcePlanId: planId, occurrenceIndex: 0 })

    const summary = await mergeAllTables(emptyData({ transactions: [duplicateA, duplicateB] }))

    expect(summary.transactions).toEqual({ added: 1, skipped: 1 })
    const stored = await db.transactions.where('sourcePlanId').equals(planId).toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.id).toBe(duplicateA.id)
  })
})
