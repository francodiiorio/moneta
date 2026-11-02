import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createCategory } from './categories.repo'
import { createCreditCard } from './creditCards.repo'
import { applyStatementImport } from './statementImport.repo'

afterEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('applyStatementImport', () => {
  it('writes nothing — no dates, no gastos — when one part fails', async () => {
    const card = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    await expect(
      applyStatementImport(
        {
          cardId: card.id,
          period: '2026-10',
          dates: { closeDate: '2026-10-20', dueDate: '2026-11-03' },
          fallbackCategoryName: 'Impuestos y comisiones',
          expenses: [
            { date: '2026-10-08', description: 'Rappi', categoryId: comida.id, amount: 1_000_00, currency: 'ARS', status: 'confirmed', cardId: card.id, statementPeriod: '2026-10' },
          ],
          // An invalid plan (cuota 13 of 12) after the gasto and the dates.
          plans: [
            { description: 'Tienda', categoryId: comida.id, currency: 'ARS', totalAmount: 1_200_00, count: 12, firstDueDate: '2026-04-06', purchaseDate: '2026-04-06', cardId: card.id, startIndex: 12 },
          ],
        },
        '2026-11-01',
      ),
    ).rejects.toThrow()
    expect(await db.expenses.count()).toBe(0)
    expect(await db.cardStatements.count()).toBe(0)
    expect(await db.categories.count()).toBe(1)
  })

  it('creates the charges category once for every charge without one', async () => {
    const card = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4 })
    const charge = (description: string, amount: number) => ({
      date: '2026-10-22',
      description,
      categoryId: undefined,
      amount,
      currency: 'ARS',
      status: 'confirmed' as const,
      cardId: card.id,
      statementPeriod: '2026-10',
    })
    await applyStatementImport(
      {
        cardId: card.id,
        period: '2026-10',
        dates: { closeDate: '2026-10-22', dueDate: '2026-11-04' },
        fallbackCategoryName: 'Impuestos y comisiones',
        expenses: [charge('Impuesto de sellos', 300_00), charge('IVA', 63_00)],
        plans: [],
      },
      '2026-11-01',
    )
    const categories = await db.categories.toArray()
    expect(categories.map((c) => c.name)).toEqual(['Impuestos y comisiones'])
    expect(new Set((await db.expenses.toArray()).map((e) => e.categoryId))).toEqual(new Set([categories[0]!.id]))
  })
})
