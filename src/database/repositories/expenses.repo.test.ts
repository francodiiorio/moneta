import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { createCategory } from './categories.repo'
import {
  confirmDueProjected,
  deleteAllBySourcePlanId,
  deleteExpense,
  deleteProjectedBySourcePlanId,
  listExpensesInRange,
  listPlanExpenses,
  saveExpense,
  type ExpenseInput,
} from './expenses.repo'

afterEach(async () => {
  await Promise.all([db.categories.clear(), db.expenses.clear()])
})

async function setup() {
  return createCategory({ kind: 'expense', name: 'Comida' })
}

function input(categoryId: string, overrides: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    date: '2026-08-23',
    description: 'Super',
    categoryId,
    amount: 1500,
    currency: 'ARS',
    status: 'confirmed',
    ...overrides,
  }
}

describe('saveExpense', () => {
  it('rejects a non-positive amount without writing anything', async () => {
    const category = await setup()
    await expect(saveExpense(input(category.id, { amount: 0 }))).rejects.toThrow(/mayor a cero/)
    expect(await db.expenses.count()).toBe(0)
  })

  it('creates a confirmed gasto with a fresh id and matching createdAt/updatedAt', async () => {
    const category = await setup()
    const id = await saveExpense(input(category.id))
    const stored = await db.expenses.get(id)
    expect(stored).toMatchObject({ description: 'Super', amount: 1500, currency: 'ARS', categoryId: category.id })
    expect(stored?.createdAt).toBe(stored?.updatedAt)
  })

  it('editing an existing id overwrites the row wholesale, preserving id and createdAt', async () => {
    // saveExpense stamps createdAt/updatedAt with new Date().toISOString()
    // (millisecond resolution) — two real-clock calls back to back can
    // land in the same millisecond and flake the updatedAt-changed
    // assertion below. Faking only Date (not timers) keeps Dexie's own
    // async scheduling untouched while making the two calls deterministic.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const category = await setup()
      const id = await saveExpense(input(category.id))
      const original = await db.expenses.get(id)

      vi.advanceTimersByTime(1)
      await saveExpense(input(category.id, { description: 'Super (editado)', amount: 2000 }), id)

      expect(await db.expenses.count()).toBe(1)
      const updated = await db.expenses.get(id)
      expect(updated).toMatchObject({ id, description: 'Super (editado)', amount: 2000 })
      expect(updated?.createdAt).toBe(original?.createdAt)
      expect(updated?.updatedAt).not.toBe(original?.updatedAt)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects editing an id that does not exist', async () => {
    const category = await setup()
    await expect(saveExpense(input(category.id), 'no-existe')).rejects.toThrow(/No se encontró/)
  })
})

describe('listExpensesInRange', () => {
  it('includes both range boundaries and excludes anything outside them', async () => {
    const category = await setup()
    await saveExpense(input(category.id, { date: '2026-08-01', description: 'Inicio' }))
    await saveExpense(input(category.id, { date: '2026-08-31', description: 'Fin' }))
    await saveExpense(input(category.id, { date: '2026-09-01', description: 'Fuera' }))

    const items = await listExpensesInRange('2026-08-01', '2026-08-31')
    expect(items.map((e) => e.description).sort()).toEqual(['Fin', 'Inicio'])
  })

  it('sorts by date descending, then by createdAt descending within the same date', async () => {
    const category = await setup()
    await saveExpense(input(category.id, { date: '2026-08-01', description: 'Primero' }))
    await saveExpense(input(category.id, { date: '2026-08-15', description: 'Segundo' }))

    const items = await listExpensesInRange('2026-08-01', '2026-08-31')
    expect(items.map((e) => e.description)).toEqual(['Segundo', 'Primero'])
  })
})

describe('deleteExpense', () => {
  it('removes the row', async () => {
    const category = await setup()
    const id = await saveExpense(input(category.id))
    await deleteExpense(id)
    expect(await db.expenses.get(id)).toBeUndefined()
  })
})

describe('listPlanExpenses / deleteProjectedBySourcePlanId / deleteAllBySourcePlanId', () => {
  it('listPlanExpenses only returns expenses with a sourcePlanId set', async () => {
    const category = await setup()
    await saveExpense(input(category.id, { description: 'Manual' }))
    await saveExpense(input(category.id, { description: 'De un plan', sourcePlanId: 'plan1', occurrenceIndex: 0 }))

    const planExpenses = await listPlanExpenses()
    expect(planExpenses).toHaveLength(1)
    expect(planExpenses[0]?.description).toBe('De un plan')
  })

  it('deleteProjectedBySourcePlanId only deletes still-projected occurrences', async () => {
    const category = await setup()
    await saveExpense(input(category.id, { description: 'Confirmado', status: 'confirmed', sourcePlanId: 'plan1', occurrenceIndex: 0 }))
    await saveExpense(input(category.id, { description: 'Proyectado', status: 'projected', sourcePlanId: 'plan1', occurrenceIndex: 1 }))

    await deleteProjectedBySourcePlanId('plan1')

    const remaining = await listPlanExpenses()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.description).toBe('Confirmado')
  })

  it('deleteAllBySourcePlanId deletes confirmed occurrences too', async () => {
    const category = await setup()
    await saveExpense(input(category.id, { status: 'confirmed', sourcePlanId: 'plan1', occurrenceIndex: 0 }))
    await saveExpense(input(category.id, { status: 'projected', sourcePlanId: 'plan1', occurrenceIndex: 1 }))

    await deleteAllBySourcePlanId('plan1')

    expect(await listPlanExpenses()).toEqual([])
  })
})

describe('confirmDueProjected', () => {
  it('promotes only projected expenses on or before the given date', async () => {
    const category = await setup()
    await saveExpense(input(category.id, { date: '2026-08-01', status: 'projected', description: 'Vencida' }))
    await saveExpense(input(category.id, { date: '2026-09-01', status: 'projected', description: 'Futura' }))
    await saveExpense(input(category.id, { date: '2026-08-01', status: 'confirmed', description: 'Ya confirmada' }))

    const promoted = await confirmDueProjected('2026-08-15')
    expect(promoted).toBe(1)

    const all = await db.expenses.toArray()
    expect(all.find((e) => e.description === 'Vencida')?.status).toBe('confirmed')
    expect(all.find((e) => e.description === 'Futura')?.status).toBe('projected')
  })

  it('is idempotent — a second run promotes nothing new', async () => {
    const category = await setup()
    await saveExpense(input(category.id, { date: '2026-08-01', status: 'projected' }))

    await confirmDueProjected('2026-08-15')
    const second = await confirmDueProjected('2026-08-15')
    expect(second).toBe(0)
  })
})

describe('saveExpense — debit from an account (Etapa 8)', () => {
  afterEach(async () => {
    await db.accounts.clear()
  })

  async function account() {
    const { createAccount } = await import('./accounts.repo')
    return createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-08-01' })
  }

  it('stores the accountId', async () => {
    const category = await setup()
    const { id: accountId } = await account()
    const id = await saveExpense(input(category.id, { accountId }))
    expect((await db.expenses.get(id))?.accountId).toBe(accountId)
  })

  it('rejects a currency other than the account’s', async () => {
    const category = await setup()
    const { id: accountId } = await account()
    await expect(saveExpense(input(category.id, { accountId, currency: 'USD' }))).rejects.toThrow(/es en ARS/)
    expect(await db.expenses.count()).toBe(0)
  })

  it('rejects a date before the account opening date', async () => {
    const category = await setup()
    const { id: accountId } = await account()
    await expect(saveExpense(input(category.id, { accountId, date: '2026-07-31' }))).rejects.toThrow(/saldo inicial/)
  })

  it('editing to drop the account removes accountId', async () => {
    const category = await setup()
    const { id: accountId } = await account()
    const id = await saveExpense(input(category.id, { accountId }))
    await saveExpense(input(category.id), id)
    expect((await db.expenses.get(id))?.accountId).toBeUndefined()
  })
})

describe('saveExpense — category kind', () => {
  it('rejects an income category (backup import would refuse it later)', async () => {
    const incomeCategory = await createCategory({ kind: 'income', name: 'Sueldo' })
    await expect(saveExpense(input(incomeCategory.id))).rejects.toThrow(/no es una categoría de gasto/)
    expect(await db.expenses.count()).toBe(0)
  })

  it('rejects a category that does not exist', async () => {
    await expect(saveExpense(input('nope'))).rejects.toThrow(/Categoría no encontrada/)
  })
})
