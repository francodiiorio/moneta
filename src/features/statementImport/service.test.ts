import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createCategory } from '@/database/repositories/categories.repo'
import { createCreditCard, getCardCalendar } from '@/database/repositories/creditCards.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import { createInstallmentPlan } from '@/database/repositories/installmentPlans.repo'
import { createRecurringPlan } from '@/database/repositories/recurringPlans.repo'
import { payStatement } from '@/database/repositories/statementPayments.repo'
import { createAccount } from '@/database/repositories/accounts.repo'
import { setCategoryArchived } from '@/database/repositories/categories.repo'
import { statementDates } from '@/domain/cards'
import type { CreditCard } from '@/domain/entities'
import type { ParsedStatement } from './bbva'
import { buildImportPreview, guessCardFor, importCheck, importStatement, initialChoices, type RowChoice } from './service'

afterEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

const STATEMENT: ParsedStatement = {
  product: 'Visa Gold',
  account: '1111111111',
  closeDate: '2026-10-22',
  dueDate: '2026-11-04',
  nextCloseDate: '2026-11-19',
  nextDueDate: '2026-12-03',
  balance: { ARS: 80_300_00, USD: 0 },
  previousBalance: { ARS: 50_000_00, USD: 0 },
  items: [
    { section: 'payments', date: '2026-10-05', description: 'SU PAGO EN PESOS', cashAdvance: false, currency: 'ARS', amount: -50_000_00 },
    { section: 'payments', date: '2026-10-05', description: 'NETFLIX.COM', cashAdvance: false, currency: 'USD', amount: -5_90 },
    { section: 'payments', date: '2026-10-22', description: 'IIBB PERCEP-BSAS 2,00%( 9003,40)', cashAdvance: false, currency: 'ARS', amount: -180_00 },
    {
      section: 'purchases',
      date: '2026-04-06',
      description: 'MERPAGO*MERCADOLIBRE',
      installment: { number: 7, count: 12 },
      cashAdvance: false,
      currency: 'ARS',
      amount: 10_000_00,
    },
    { section: 'purchases', date: '2026-09-26', description: 'MERPAGO*BETWARRIOR', cashAdvance: true, currency: 'ARS', amount: 50_000_00 },
    { section: 'purchases', date: '2026-10-08', description: 'DLO*RAPPI', cashAdvance: false, currency: 'ARS', amount: 20_000_00 },
    { section: 'purchases', date: '2026-10-05', description: 'NETFLIX.COM', cashAdvance: false, currency: 'USD', amount: 5_90 },
    { section: 'charges', date: '2026-10-22', description: 'IMPUESTO DE SELLOS $', cashAdvance: false, currency: 'ARS', amount: 300_00 },
    { section: 'charges', date: '2026-10-22', description: 'IIBB PERCEP-BSAS 2,00%( 9003,40)', cashAdvance: false, currency: 'ARS', amount: 180_00 },
  ],
}

async function setup() {
  const card = await createCreditCard({ name: 'visa 2551', closingDay: 22, dueDay: 4 })
  const comida = await createCategory({ kind: 'expense', name: 'Comida' })
  const otros = await createCategory({ kind: 'expense', name: 'Otros' })
  return { card, comida, otros }
}

const all = new Map<string, RowChoice>()

describe('statement import', () => {
  it('proposes each line: new, cancelled against its credit, or skipped', async () => {
    const { card, comida, otros } = await setup()
    const preview = await buildImportPreview(STATEMENT, card.id)
    expect(preview.period).toBe('2026-10')
    expect(preview.rows.map((r) => [r.description, r.kind, r.status])).toEqual([
      ['Su Pago en Pesos', 'purchase', 'skipped'],
      ['Netflix.com', 'purchase', 'cancelled'],
      ['Percepción IIBB', 'purchase', 'cancelled'],
      ['Mercado Libre', 'installment', 'new'],
      ['Betwarrior (adelanto en efectivo)', 'purchase', 'new'],
      ['Rappi', 'purchase', 'new'],
      ['Netflix.com', 'purchase', 'cancelled'],
      ['Impuesto de sellos', 'charge', 'new'],
      ['Percepción IIBB', 'charge', 'cancelled'],
    ])
    // Rappi is food; an unknown merchant goes to Otros; a charge waits for its category.
    expect(preview.rows[5]?.categoryId).toBe(comida.id)
    expect(preview.rows[3]?.categoryId).toBe(otros.id)
    expect(preview.rows[7]?.categoryId).toBe('')
    expect(importCheck(preview, all)).toEqual([{ currency: 'ARS', bank: 80_300_00, moneta: 80_300_00 }])
  })

  it('imports the statement: gastos pinned to it, a plan from the billed cuota, charges in their category, the real dates', async () => {
    const { card } = await setup()
    const preview = await buildImportPreview(STATEMENT, card.id)
    expect(await importStatement(preview, all, '2026-11-01')).toEqual({ expenses: 3, plans: 1, datesSkipped: false })

    const october = await db.expenses.where('[cardId+statementPeriod]').equals([card.id, '2026-10']).toArray()
    expect(october.reduce((sum, e) => sum + e.amount, 0)).toBe(80_300_00)
    const charges = await db.categories.filter((c) => c.name === 'Impuestos y comisiones').first()
    expect(october.find((e) => e.description === 'Impuesto de sellos')?.categoryId).toBe(charges?.id)

    const [plan] = await db.installmentPlans.toArray()
    expect(plan).toMatchObject({ description: 'Mercado Libre', count: 12, startIndex: 6, totalAmount: 120_000_00 })
    expect(await db.expenses.where('sourcePlanId').equals(plan!.id).count()).toBe(6)

    const calendar = await getCardCalendar(card.id)
    expect(statementDates(calendar, '2026-11')).toMatchObject({ closeDate: '2026-11-19', dueDate: '2026-12-03' })
  })

  it('importing the same statement again adds nothing', async () => {
    const { card } = await setup()
    await importStatement(await buildImportPreview(STATEMENT, card.id), all, '2026-11-01')
    const again = await buildImportPreview(STATEMENT, card.id)
    expect(again.rows.filter((r) => r.status === 'new')).toEqual([])
    expect(again.rows.filter((r) => r.status === 'loaded').map((r) => r.description)).toEqual([
      'Mercado Libre',
      'Betwarrior (adelanto en efectivo)',
      'Rappi',
      'Impuesto de sellos',
    ])
    expect(importCheck(again, all)).toEqual([{ currency: 'ARS', bank: 80_300_00, moneta: 80_300_00 }])
  })

  it('unticked rows stay out, and the check shows the gap', async () => {
    const { card } = await setup()
    const preview = await buildImportPreview(STATEMENT, card.id)
    const rappi = preview.rows.find((r) => r.description === 'Rappi')!
    const choices = new Map([[rappi.key, { include: false, categoryId: rappi.categoryId }]])
    expect(importCheck(preview, choices)).toEqual([{ currency: 'ARS', bank: 80_300_00, moneta: 60_300_00 }])
    expect(await importStatement(preview, choices, '2026-11-01')).toEqual({ expenses: 2, plans: 1, datesSkipped: false })
  })

  it('learns: a merchant goes where the user put it last time', async () => {
    const { card } = await setup()
    const salidas = await createCategory({ kind: 'expense', name: 'Salidas' })
    await saveExpense({ date: '2026-09-01', description: 'Rappi', categoryId: salidas.id, amount: 1_00, currency: 'ARS', status: 'confirmed' })
    const preview = await buildImportPreview(STATEMENT, card.id)
    expect(preview.rows.find((r) => r.description === 'Rappi')?.categoryId).toBe(salidas.id)
  })

  it('a gasto loaded by hand with the same date and amount isn’t imported twice', async () => {
    const { card, comida } = await setup()
    await saveExpense({ date: '2026-10-08', description: 'rappi', categoryId: comida.id, amount: 20_000_00, currency: 'ARS', status: 'confirmed', cardId: card.id })
    const preview = await buildImportPreview(STATEMENT, card.id)
    expect(preview.rows.find((r) => r.description === 'Rappi')?.status).toBe('loaded')
  })
})

describe('statement import — edge cases', () => {
  const only = (items: ParsedStatement['items'], extra: Partial<ParsedStatement> = {}): ParsedStatement => {
    const sum = { ARS: 0, USD: 0 }
    for (const i of items) sum[i.currency] += i.amount
    return { ...STATEMENT, items, previousBalance: { ARS: 0, USD: 0 }, balance: sum, ...extra }
  }
  const purchase = (date: string, description: string, amount: number, extra: Partial<ParsedStatement['items'][number]> = {}) => ({
    section: 'purchases' as const,
    date,
    description,
    cashAdvance: false,
    currency: 'ARS' as const,
    amount,
    ...extra,
  })

  it('a line the PDF reader missed shows up against the printed balance — never a false "coincide"', async () => {
    const { card } = await setup()
    const statement = only([purchase('2026-10-08', 'DLO*RAPPI', 20_000_00)], { balance: { ARS: 25_000_00, USD: 0 } })
    const preview = await buildImportPreview(statement, card.id)
    expect(preview.unread.ARS).toBe(5_000_00)
    expect(importCheck(preview, initialChoices(preview))).toEqual([{ currency: 'ARS', bank: 25_000_00, moneta: 20_000_00 }])
  })

  it('a card whose closing-day purchases go to the next statement still imports the charges dated on the close', async () => {
    const card = await createCreditCard({ name: 'visa', closingDay: 22, dueDay: 4, closingDayToNext: true })
    await createCategory({ kind: 'expense', name: 'Otros' })
    const statement = only([{ section: 'charges', date: '2026-10-22', description: 'IMPUESTO DE SELLOS $', cashAdvance: false, currency: 'ARS', amount: 300_00 }])
    const preview = await buildImportPreview(statement, card.id)
    expect(preview.rows[0]?.bookDate).toBe('2026-10-21')
    await importStatement(preview, initialChoices(preview), '2026-11-01')
    const [sellos] = await db.expenses.toArray()
    expect(sellos).toMatchObject({ date: '2026-10-21', statementPeriod: '2026-10' })
  })

  it('a cuota the card places in another statement doesn’t count toward this one', async () => {
    const { card } = await setup()
    // Cuota 1 of a purchase made after this statement's close lands in the next one.
    const statement = only([purchase('2026-10-25', 'MERPAGO*TIENDA', 1_000_00, { installment: { number: 1, count: 3 } })])
    const preview = await buildImportPreview(statement, card.id)
    expect(preview.rows[0]?.period).toBe('2026-11')
    expect(importCheck(preview, initialChoices(preview))).toEqual([{ currency: 'ARS', bank: 1_000_00, moneta: 0 }])
  })

  it('a subscription already generated by a recurring plan on the card isn’t imported again', async () => {
    const { card, comida } = await setup()
    const plan = await createRecurringPlan({
      template: { description: 'Netflix', categoryId: comida.id, amount: 9_000_00, currency: 'ARS', cardId: card.id },
      rule: { freq: 'monthly', interval: 1, dayOfMonth: 5, startDate: '2026-10-05' },
    })
    await saveExpense({ date: '2026-10-05', description: 'Netflix', categoryId: comida.id, amount: 9_000_00, currency: 'ARS', status: 'confirmed', cardId: card.id, sourcePlanId: plan.id, occurrenceIndex: 0 })
    const preview = await buildImportPreview(only([purchase('2026-10-05', 'NETFLIX.COM', 9_000_00)]), card.id)
    expect(preview.rows[0]?.status).toBe('loaded')
  })

  it('a zero line is skipped instead of failing the import', async () => {
    const { card } = await setup()
    const preview = await buildImportPreview(only([purchase('2026-10-05', 'BONIFICACION', 0)]), card.id)
    expect(preview.rows[0]).toMatchObject({ status: 'skipped', note: 'Monto cero' })
    expect(await importStatement(preview, initialChoices(preview), '2026-11-01')).toMatchObject({ expenses: 0 })
  })

  it('a refund only cancels a charge of the same merchant — not any other with the same amount', async () => {
    const { card } = await setup()
    const statement = only([
      { section: 'payments', date: '2026-10-05', description: 'MERPAGO*TIENDA', cashAdvance: false, currency: 'ARS', amount: -1_000_00 },
      purchase('2026-10-08', 'DLO*RAPPI', 1_000_00),
    ])
    const preview = await buildImportPreview(statement, card.id)
    expect(preview.rows.map((r) => r.status)).toEqual(['skipped', 'new'])
  })

  it('a cancelled or loaded row can still be imported on purpose', async () => {
    const { card } = await setup()
    const preview = await buildImportPreview(STATEMENT, card.id)
    const netflix = preview.rows.find((r) => r.status === 'cancelled' && !r.credit)!
    const choices = initialChoices(preview)
    choices.set(netflix.key, { include: true, categoryId: netflix.categoryId })
    expect(await importStatement(preview, choices, '2026-11-01')).toMatchObject({ expenses: 4 })
  })

  it('an installment purchase loaded by hand a day off is flagged, unticked, not created twice', async () => {
    const { card, otros } = await setup()
    await createInstallmentPlan(
      { description: 'Mercado Libre', categoryId: otros.id, currency: 'ARS', totalAmount: 120_000_00, count: 12, firstDueDate: '2026-04-07', purchaseDate: '2026-04-07', cardId: card.id, startIndex: 6 },
      '2026-11-01',
    )
    const preview = await buildImportPreview(STATEMENT, card.id)
    const meli = preview.rows.find((r) => r.kind === 'installment')!
    expect(meli).toMatchObject({ status: 'new', suggested: false })
    expect(meli.note).toMatch(/Puede ser "Mercado Libre"/)
  })

  it('a statement already paid in Moneta imports its gastos and keeps its dates', async () => {
    const card = await createCreditCard({ name: 'visa', closingDay: 25, dueDay: 5 })
    const comida = await createCategory({ kind: 'expense', name: 'Comida' })
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: 0, openingDate: '2026-01-01' })
    await saveExpense({ date: '2026-10-01', description: 'Super', categoryId: comida.id, amount: 1_00, currency: 'ARS', status: 'confirmed', cardId: card.id })
    await payStatement({ cardId: card.id, period: '2026-10', date: '2026-10-30', lines: [{ currency: 'ARS', amount: 1_00, accountId: account.id, expectedAccountCurrency: 'ARS' }] })
    const preview = await buildImportPreview(only([purchase('2026-10-08', 'DLO*RAPPI', 20_000_00)]), card.id)
    expect(preview.datesLocked).toBe(true)
    expect(await importStatement(preview, initialChoices(preview), '2026-11-01')).toEqual({ expenses: 1, plans: 0, datesSkipped: true })
    expect(statementDates(await getCardCalendar(card.id), '2026-10').closeDate).toBe('2026-10-25')
  })

  it('an archived charges category comes back instead of a duplicate', async () => {
    const { card } = await setup()
    const archived = await createCategory({ kind: 'expense', name: 'Impuestos y comisiones' })
    await setCategoryArchived(archived.id, true)
    const preview = await buildImportPreview(STATEMENT, card.id)
    await importStatement(preview, initialChoices(preview), '2026-11-01')
    const named = await db.categories.filter((c) => c.name === 'Impuestos y comisiones').toArray()
    expect(named).toEqual([expect.objectContaining({ id: archived.id, isArchived: false })])
  })
})

describe('guessCardFor', () => {
  const card = (id: string, name: string, notes?: string): CreditCard => ({
    id,
    name,
    closingDay: 22,
    dueDay: 4,
    isArchived: false,
    order: 0,
    createdAt: '',
    updatedAt: '',
    ...(notes && { notes }),
  })

  it('by the account number in its notes, else the only card of its brand', () => {
    const cards = [card('a', 'visa black'), card('b', 'visa 2551', 'BBVA, cuenta 1111111111'), card('c', 'master 7161')]
    expect(guessCardFor({ account: '1111111111', product: 'Visa Gold' }, cards)).toBe('b')
    expect(guessCardFor({ account: '999', product: 'Mastercard Gold' }, cards)).toBe('c')
    // Two Visas and no account match: no guess.
    expect(guessCardFor({ account: '999', product: 'Visa Gold' }, cards)).toBeUndefined()
  })
})
