import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createCategory } from '@/database/repositories/categories.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import type { CsvMapping } from './schema'
import { createCreditCard } from '@/database/repositories/creditCards.repo'
import {
  CSV_IMPORT_TAG,
  buildPreview,
  cardStatementChoices,
  importSelectedRows,
  loadExistingDuplicateKeys,
  prepareImport,
} from './service'

afterEach(async () => {
  await Promise.all([
    db.statementPayments.clear(),
    db.categories.clear(),
    db.expenses.clear(),
    db.creditCards.clear(),
    db.cardStatements.clear(),
  ])
})

const singleAmountMapping: CsvMapping = {
  destination: { kind: 'none' },
  categoryId: 'cat-expense',
  currency: 'ARS',
  hasHeaderRow: true,
  encoding: 'utf-8',
  dateFormat: 'dd/MM/yyyy',
  dateColumn: 0,
  descriptionColumn: 1,
  amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-expense' },
}

const debitCreditMapping: CsvMapping = {
  ...singleAmountMapping,
  amount: { mode: 'debit-credit', debitColumn: 2, creditColumn: 3 },
}

describe('buildPreview — single amount column', () => {
  it('treats a positive amount as an expense (positive-is-expense)', () => {
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Super', '1500'],
      ['24/08/2026', 'Sueldo', '-50000'],
    ]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())

    // parseAmount interprets "1500" as $1500 (major units) -> 150000 minor.
    expect(preview[0]).toMatchObject({ amount: { amount: 150_000, currency: 'ARS' }, status: 'new' })
    expect(preview[1]).toMatchObject({ status: 'excluded' })
  })

  it('inverts the sign meaning with positive-is-income', () => {
    const mapping: CsvMapping = {
      ...singleAmountMapping,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-income' },
    }
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Super', '-1500']]
    const preview = buildPreview(rows, mapping, 'ARS', new Set())
    expect(preview[0]?.status).toBe('new')
  })

  it('reads an es-AR amount with dot thousands and no decimals ("15.000") as fifteen thousand', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Alquiler', '15.000'], ['24/08/2026', 'Luz', '12.345,67']]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())
    expect(preview[0]).toMatchObject({ amount: { amount: 1_500_000, currency: 'ARS' } })
    expect(preview[1]).toMatchObject({ amount: { amount: 1_234_567, currency: 'ARS' } })
  })

  it('flags an unparseable amount cell as invalid', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Super', 'n/a']]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())
    expect(preview[0]?.status).toBe('invalid')
    expect(preview[0]?.invalidReason).toContain('monto')
  })
})

describe('buildPreview — debit/credit columns', () => {
  it('treats a filled debit column as an expense', () => {
    const rows = [['fecha', 'descripcion', 'debito', 'credito'], ['23/08/2026', 'Super', '1500', '']]
    const preview = buildPreview(rows, debitCreditMapping, 'ARS', new Set())
    expect(preview[0]).toMatchObject({ amount: { amount: 150_000 }, status: 'new' })
  })

  it('treats a filled credit column as excluded (not a gasto)', () => {
    const rows = [['fecha', 'descripcion', 'debito', 'credito'], ['24/08/2026', 'Sueldo', '', '50000']]
    const preview = buildPreview(rows, debitCreditMapping, 'ARS', new Set())
    expect(preview[0]).toMatchObject({ status: 'excluded' })
  })

  it('flags a row with both or neither column filled as invalid', () => {
    const rows = [
      ['fecha', 'descripcion', 'debito', 'credito'],
      ['23/08/2026', 'Ambos', '100', '200'],
      ['23/08/2026', 'Ninguno', '', ''],
    ]
    const preview = buildPreview(rows, debitCreditMapping, 'ARS', new Set())
    expect(preview[0]?.status).toBe('invalid')
    expect(preview[1]?.status).toBe('invalid')
  })

  it('treats an explicit "0,00" in the unused column as empty, not as "both filled"', () => {
    // Common in real bank exports: the column that doesn't apply to a row
    // is written as an explicit zero instead of being left blank.
    const rows = [
      ['fecha', 'descripcion', 'debito', 'credito'],
      ['23/08/2026', 'Gasto', '350,00', '0,00'],
      ['24/08/2026', 'Ingreso', '0,00', '12000,00'],
    ]
    const preview = buildPreview(rows, debitCreditMapping, 'ARS', new Set())
    expect(preview[0]).toMatchObject({ status: 'new' })
    expect(preview[1]).toMatchObject({ status: 'excluded' })
  })

  it('still flags a row as invalid when both columns are genuinely non-zero', () => {
    const rows = [['fecha', 'descripcion', 'debito', 'credito'], ['23/08/2026', 'Ambos', '100,00', '200,00']]
    const preview = buildPreview(rows, debitCreditMapping, 'ARS', new Set())
    expect(preview[0]?.status).toBe('invalid')
  })
})

describe('buildPreview — row-level validation and indexing', () => {
  it('flags an unparseable date and an empty description as invalid, with reasons', () => {
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['no es una fecha', 'Super', '1500'],
      ['23/08/2026', '   ', '1500'],
    ]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())
    expect(preview[0]?.status).toBe('invalid')
    expect(preview[0]?.invalidReason).toContain('fecha')
    expect(preview[1]?.status).toBe('invalid')
    expect(preview[1]?.invalidReason).toContain('descripción')
  })

  it('skips the header row and keeps indices aligned to the raw rows array', () => {
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Fila 1', '100'],
      ['24/08/2026', 'Fila 2', '200'],
    ]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())
    expect(preview.map((r) => r.index)).toEqual([1, 2])
  })

  it('does not skip any row when hasHeaderRow is false', () => {
    const mapping: CsvMapping = { ...singleAmountMapping, hasHeaderRow: false }
    const rows = [['23/08/2026', 'Fila 1', '100']]
    const preview = buildPreview(rows, mapping, 'ARS', new Set())
    expect(preview).toHaveLength(1)
    expect(preview[0]?.index).toBe(0)
  })

  it('flags a row shorter than the configured column index as invalid instead of throwing', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Fila corta']]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())
    expect(preview[0]?.status).toBe('invalid')
    expect(preview[0]?.invalidReason).toContain('monto')
  })

  it('returns an empty array for a CSV with no data rows', () => {
    const rows = [['fecha', 'descripcion', 'monto']]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())
    expect(preview).toEqual([])
  })
})

describe('buildPreview — duplicate detection', () => {
  it('marks a row matching an existing key as a duplicate, unchecked by default', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Super', '1500']]
    const existingKeys = new Set(['2026-08-23|150000|ARS|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]).toMatchObject({ status: 'duplicate', defaultSelected: false })
  })

  it('is case/whitespace-insensitive on the description when matching', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', '  SUPER  ', '1500']]
    const existingKeys = new Set(['2026-08-23|150000|ARS|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]?.status).toBe('duplicate')
  })

  it('does not flag a row as duplicate when the amount differs', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Super', '1600']]
    const existingKeys = new Set(['2026-08-23|150000|ARS|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]).toMatchObject({ status: 'new', defaultSelected: true })
  })
})

describe('loadExistingDuplicateKeys / prepareImport / importSelectedRows (integration)', () => {
  async function setup() {
    const category = await createCategory({ kind: 'expense', name: 'Varios' })
    return { category }
  }

  it('detects a duplicate against a real seeded expense', async () => {
    const { category } = await setup()

    await saveExpense({
      date: '2026-08-23',
      description: 'Super',
      categoryId: category.id,
      amount: 150_000,
      currency: 'ARS',
      status: 'confirmed',
    })

    const keys = await loadExistingDuplicateKeys('2026-08-01', '2026-08-31')
    expect(keys.has('2026-08-23|150000|ARS|super')).toBe(true)

    const keysOutsideRange = await loadExistingDuplicateKeys('2026-09-01', '2026-09-30')
    expect(keysOutsideRange.size).toBe(0)
  })

  it('prepareImport flags the pre-existing expense as a duplicate', async () => {
    const { category } = await setup()
    await saveExpense({
      date: '2026-08-23',
      description: 'Super',
      categoryId: category.id,
      amount: 150_000,
      currency: 'ARS',
      status: 'confirmed',
    })

    const mapping: CsvMapping = {
      destination: { kind: 'none' },
      categoryId: category.id,
      currency: 'ARS',
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-expense' },
    }
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Super', '1500'], // duplicate of the seeded expense
      ['24/08/2026', 'Otro gasto', '5000'], // genuinely new
    ]

    const preview = await prepareImport(rows, mapping)
    expect(preview[0]?.status).toBe('duplicate')
    expect(preview[1]?.status).toBe('new')
  })

  it('importSelectedRows creates exactly the selected rows, tagged and categorized', async () => {
    const { category } = await setup()
    const mapping: CsvMapping = {
      destination: { kind: 'none' },
      categoryId: category.id,
      currency: 'ARS',
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-expense' },
    }
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Super', '1500'],
      ['24/08/2026', 'Almacén', '500'],
    ]
    const preview = await prepareImport(rows, mapping)

    const result = await importSelectedRows(preview, mapping)
    expect(result.imported).toBe(2)

    const expenses = await db.expenses.toArray()
    expect(expenses.every((e) => e.tags?.includes(CSV_IMPORT_TAG))).toBe(true)
    expect(expenses.every((e) => e.categoryId === category.id)).toBe(true)
    expect(expenses.find((e) => e.description === 'Super')?.amount).toBe(150_000)
  })

  it('excludes credit rows from what gets imported', async () => {
    const { category } = await setup()
    const mapping: CsvMapping = {
      destination: { kind: 'none' },
      categoryId: category.id,
      currency: 'ARS',
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'debit-credit', debitColumn: 2, creditColumn: 3 },
    }
    const rows = [
      ['fecha', 'descripcion', 'debito', 'credito'],
      ['23/08/2026', 'Super', '1500', ''],
      ['24/08/2026', 'Sueldo', '', '50000'],
    ]
    const preview = await prepareImport(rows, mapping)
    expect(preview[0]?.status).toBe('new')
    expect(preview[1]?.status).toBe('excluded')
    expect(preview[1]?.defaultSelected).toBe(false)
  })

  it('is all-or-nothing if an invalid row somehow slips through', async () => {
    const { category } = await setup()
    const mapping: CsvMapping = {
      destination: { kind: 'none' },
      categoryId: category.id,
      currency: 'ARS',
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-expense' },
    }
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Válida', '1500'],
      ['no es una fecha', 'Inválida', '100'],
    ]
    const preview = await prepareImport(rows, mapping)
    expect(preview[1]?.status).toBe('invalid')

    await expect(importSelectedRows(preview, mapping)).rejects.toThrow()
    expect(await db.expenses.count()).toBe(0)
  })

  it('only imports rows the caller actually passes in (the UI filters unselected ones out)', async () => {
    const { category } = await setup()
    const mapping: CsvMapping = {
      destination: { kind: 'none' },
      categoryId: category.id,
      currency: 'ARS',
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-expense' },
    }
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Uno', '100'],
      ['24/08/2026', 'Dos', '200'],
    ]
    const preview = await prepareImport(rows, mapping)

    const result = await importSelectedRows([preview[0]!], mapping)
    expect(result.imported).toBe(1)
    expect(await db.expenses.count()).toBe(1)
  })
})

describe('import to a card', () => {
  async function setup() {
    const gastos = await createCategory({ kind: 'expense', name: 'Varios' })
    const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
    return { gastos, card }
  }

  it('to a card: placed by date, or all pinned to a statement (none after its close)', async () => {
    const { gastos, card } = await setup()
    const byDate: CsvMapping = { ...singleAmountMapping, categoryId: gastos.id, destination: { kind: 'card', cardId: card.id, statementPeriod: '' } }
    const cardRows = [
      ['fecha', 'descripcion', 'monto'],
      ['20/08/2026', 'Antes del cierre', '100'],
      ['26/08/2026', 'Después del cierre', '200'],
    ]
    await importSelectedRows(await prepareImport(cardRows, byDate), byDate)
    const placed = await db.expenses.toArray()
    expect(Object.fromEntries(placed.map((e) => [e.description, e.statementPeriod]))).toEqual({
      'Antes del cierre': '2026-08',
      'Después del cierre': '2026-09',
    })

    await db.expenses.clear()
    const pinned: CsvMapping = { ...byDate, destination: { kind: 'card', cardId: card.id, statementPeriod: '2026-08' } }
    const preview = await prepareImport(cardRows, pinned)
    expect(preview[1]).toMatchObject({ status: 'invalid', invalidReason: /posterior al cierre/ })
    await importSelectedRows([preview[0]!], pinned)
    expect((await db.expenses.toArray())[0]).toMatchObject({ cardId: card.id, statementPeriod: '2026-08' })
  })

  it('offers the open statement and the three before it', async () => {
    const { card } = await setup()
    const choices = await cardStatementChoices(card.id, '2026-10-24')
    expect(choices.map((c) => c.period)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07'])
  })
})

describe('import to a card — duplicados y resúmenes pagos', () => {
  async function setup() {
    const gastos = await createCategory({ kind: 'expense', name: 'Varios' })
    const card = await createCreditCard({ name: 'Visa', closingDay: 25, dueDay: 5 })
    return { gastos, card }
  }

  it('to a card: an installment already in the statement matches the bank’s row (other date, other text)', async () => {
    const { gastos, card } = await setup()
    // Cuota 2 of a purchase from July, placed by Moneta in September's statement.
    await saveExpense({
      date: '2026-09-10',
      description: 'Heladera (cuota 2/3)',
      categoryId: gastos.id,
      amount: 100_000_00,
      currency: 'ARS',
      status: 'projected',
      cardId: card.id,
      statementPeriod: '2026-09',
    })
    const mapping: CsvMapping = { ...singleAmountMapping, categoryId: gastos.id, destination: { kind: 'card', cardId: card.id, statementPeriod: '2026-09' } }
    const preview = await prepareImport(
      [
        ['fecha', 'descripcion', 'monto'],
        ['10/07/2026', 'FRAVEGA C.02/03', '100.000'],
        ['25/09/2026', 'Cierre', '10'],
      ],
      mapping,
    )
    expect(preview[0]).toMatchObject({ status: 'duplicate', duplicateOf: 'Gasto' })
    // The close day itself belongs to the statement.
    expect(preview[1]?.status).toBe('new')
  })

  it('never into a paid statement — pinned or by date — and the choice says it’s paid', async () => {
    const { gastos, card } = await setup()
    await saveExpense({ date: '2026-08-10', description: 'x', categoryId: gastos.id, amount: 100, currency: 'ARS', status: 'confirmed', cardId: card.id })
    const { payStatement } = await import('@/database/repositories/statementPayments.repo')
    await payStatement({
      cardId: card.id,
      period: '2026-08',
      date: '2026-09-05',
      lines: [{ currency: 'ARS', amount: 100 }],
    })
    const byDate: CsvMapping = { ...singleAmountMapping, categoryId: gastos.id, destination: { kind: 'card', cardId: card.id, statementPeriod: '' } }
    const rows = [['fecha', 'descripcion', 'monto'], ['12/08/2026', 'Tarde', '50'], ['27/08/2026', 'Septiembre', '50']]
    const preview = await prepareImport(rows, byDate)
    expect(preview.map((r) => r.status)).toEqual(['invalid', 'new'])
    expect(preview[0]?.invalidReason).toMatch(/ya está pagado/)

    const choices = await cardStatementChoices(card.id, '2026-10-24')
    expect(choices.find((c) => c.period === '2026-08')?.paid).toBe(true)
    expect(choices.find((c) => c.period === '2026-09')?.paid).toBe(false)
  })
})
