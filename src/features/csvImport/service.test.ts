import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createCategory } from '@/database/repositories/categories.repo'
import { saveExpense } from '@/database/repositories/expenses.repo'
import type { CsvMapping } from './schema'
import { CSV_IMPORT_TAG, buildPreview, importSelectedRows, loadExistingDuplicateKeys, prepareImport } from './service'

afterEach(async () => {
  await Promise.all([db.categories.clear(), db.expenses.clear()])
})

const singleAmountMapping: CsvMapping = {
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
    const existingKeys = new Set(['2026-08-23|150000|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]).toMatchObject({ status: 'duplicate', defaultSelected: false })
  })

  it('is case/whitespace-insensitive on the description when matching', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', '  SUPER  ', '1500']]
    const existingKeys = new Set(['2026-08-23|150000|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]?.status).toBe('duplicate')
  })

  it('does not flag a row as duplicate when the amount differs', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Super', '1600']]
    const existingKeys = new Set(['2026-08-23|150000|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]).toMatchObject({ status: 'new', defaultSelected: true })
  })
})

describe('loadExistingDuplicateKeys / prepareImport / importSelectedRows (integration)', () => {
  async function setup() {
    const category = await createCategory({ name: 'Varios' })
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
    expect(keys.has('2026-08-23|150000|super')).toBe(true)

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
