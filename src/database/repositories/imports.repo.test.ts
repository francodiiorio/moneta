import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createAccount } from './accounts.repo'
import { createCategory } from './categories.repo'
import { createCreditCard } from './creditCards.repo'
import { saveImportedMovements } from './imports.repo'

afterEach(async () => {
  await Promise.all([db.expenses.clear(), db.incomes.clear(), db.categories.clear(), db.accounts.clear(), db.creditCards.clear()])
})

async function setup() {
  const gastos = await createCategory({ kind: 'expense', name: 'Varios' })
  const ingresos = await createCategory({ kind: 'income', name: 'Sueldo' })
  const account = await createAccount({ name: 'Galicia', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
  const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
  const expense = { date: '2026-08-10', description: 'x', categoryId: gastos.id, amount: 100, currency: 'ARS', status: 'confirmed' as const }
  return { gastos, ingresos, account, card, expense }
}

describe('saveImportedMovements', () => {
  it('writes debit and card gastos plus ingresos in one go', async () => {
    const { ingresos, account, card, expense } = await setup()
    await saveImportedMovements(
      [
        { ...expense, accountId: account.id },
        { ...expense, cardId: card.id },
      ],
      [{ date: '2026-08-11', description: 'Sueldo', categoryId: ingresos.id, accountId: account.id, amount: 5000, currency: 'ARS' }],
    )
    expect(await db.expenses.count()).toBe(2)
    expect((await db.expenses.toArray()).find((e) => e.cardId)?.statementPeriod).toBe('2026-08')
    expect(await db.incomes.count()).toBe(1)
  })

  it('is all-or-nothing: one invalid row rolls back the whole batch', async () => {
    const { ingresos, account, expense } = await setup()
    await expect(
      saveImportedMovements(
        [{ ...expense, accountId: account.id }],
        // Before the account's opening date.
        [{ date: '2025-12-31', description: 'Sueldo', categoryId: ingresos.id, accountId: account.id, amount: 5000, currency: 'ARS' }],
      ),
    ).rejects.toThrow()
    expect(await db.expenses.count()).toBe(0)
    await expect(saveImportedMovements([expense, { ...expense, amount: 0 }], [])).rejects.toThrow(/mayor a cero/)
    expect(await db.expenses.count()).toBe(0)
  })
})
