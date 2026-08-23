import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createAccount, listAccountsWithBalances } from '@/database/repositories/accounts.repo'
import { createCategory } from '@/database/repositories/categories.repo'
import { saveTransaction } from '@/database/repositories/transactions.repo'
import { buildExpense } from '@/domain/ledger'
import { minor, money } from '@/domain/money'
import type { CsvMapping } from './schema'
import { CSV_IMPORT_TAG, buildPreview, importSelectedRows, loadExistingDuplicateKeys, prepareImport } from './service'

afterEach(async () => {
  await Promise.all([db.accounts.clear(), db.categories.clear(), db.transactions.clear(), db.postings.clear()])
})

const singleAmountMapping: CsvMapping = {
  accountId: 'acc1',
  expenseCategoryId: 'cat-expense',
  incomeCategoryId: 'cat-income',
  hasHeaderRow: true,
  encoding: 'utf-8',
  dateFormat: 'dd/MM/yyyy',
  dateColumn: 0,
  descriptionColumn: 1,
  amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-income' },
}

const debitCreditMapping: CsvMapping = {
  ...singleAmountMapping,
  amount: { mode: 'debit-credit', debitColumn: 2, creditColumn: 3 },
}

describe('buildPreview — single amount column', () => {
  it('treats a negative amount as an expense and a positive one as income (positive-is-income)', () => {
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Super', '-1500'],
      ['24/08/2026', 'Sueldo', '50000'],
    ]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())

    // parseAmount interprets "-1500" as -$1500 (major units) -> -150000 minor.
    expect(preview[0]).toMatchObject({ kind: 'expense', amount: { amount: 150_000, currency: 'ARS' }, status: 'new' })
    expect(preview[1]).toMatchObject({ kind: 'income', amount: { amount: 5_000_000, currency: 'ARS' }, status: 'new' })
  })

  it('inverts the sign meaning with positive-is-expense', () => {
    const mapping: CsvMapping = {
      ...singleAmountMapping,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-expense' },
    }
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Super', '1500']]
    const preview = buildPreview(rows, mapping, 'ARS', new Set())
    expect(preview[0]?.kind).toBe('expense')
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
    expect(preview[0]).toMatchObject({ kind: 'expense', amount: { amount: 150_000 }, status: 'new' })
  })

  it('treats a filled credit column as income', () => {
    const rows = [['fecha', 'descripcion', 'debito', 'credito'], ['24/08/2026', 'Sueldo', '', '50000']]
    const preview = buildPreview(rows, debitCreditMapping, 'ARS', new Set())
    expect(preview[0]).toMatchObject({ kind: 'income', amount: { amount: 5_000_000 }, status: 'new' })
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
    expect(preview[0]).toMatchObject({ kind: 'expense', status: 'new' })
    expect(preview[1]).toMatchObject({ kind: 'income', status: 'new' })
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
      ['no es una fecha', 'Super', '-1500'],
      ['23/08/2026', '   ', '-1500'],
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
      ['23/08/2026', 'Fila 1', '-100'],
      ['24/08/2026', 'Fila 2', '-200'],
    ]
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', new Set())
    expect(preview.map((r) => r.index)).toEqual([1, 2])
  })

  it('does not skip any row when hasHeaderRow is false', () => {
    const mapping: CsvMapping = { ...singleAmountMapping, hasHeaderRow: false }
    const rows = [['23/08/2026', 'Fila 1', '-100']]
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
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Super', '-1500']]
    const existingKeys = new Set(['2026-08-23|-150000|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]).toMatchObject({ status: 'duplicate', defaultSelected: false })
  })

  it('is case/whitespace-insensitive on the description when matching', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', '  SUPER  ', '-1500']]
    const existingKeys = new Set(['2026-08-23|-150000|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]?.status).toBe('duplicate')
  })

  it('does not flag a row as duplicate when the amount differs', () => {
    const rows = [['fecha', 'descripcion', 'monto'], ['23/08/2026', 'Super', '-1600']]
    const existingKeys = new Set(['2026-08-23|-150000|super'])
    const preview = buildPreview(rows, singleAmountMapping, 'ARS', existingKeys)
    expect(preview[0]).toMatchObject({ status: 'new', defaultSelected: true })
  })
})

describe('loadExistingDuplicateKeys / prepareImport / importSelectedRows (integration)', () => {
  async function setup() {
    const account = await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(100_000) })
    const expenseCategory = await createCategory({ name: 'Varios', kind: 'expense' })
    const incomeCategory = await createCategory({ name: 'Otros', kind: 'income' })
    return { account, expenseCategory, incomeCategory }
  }

  it('detects a duplicate against a real seeded transaction, scoped to the right account', async () => {
    const { account, expenseCategory } = await setup()
    const otherAccount = await createAccount({ name: 'Otro', type: 'cash', currency: 'ARS', openingBalance: minor(0) })

    await saveTransaction(
      buildExpense({ date: '2026-08-23', description: 'Super', accountId: account.id, categoryId: expenseCategory.id, amount: money(150_000, 'ARS') }),
    )

    const keysForAccount = await loadExistingDuplicateKeys(account.id, '2026-08-01', '2026-08-31')
    expect(keysForAccount.has('2026-08-23|-150000|super')).toBe(true)

    const keysForOtherAccount = await loadExistingDuplicateKeys(otherAccount.id, '2026-08-01', '2026-08-31')
    expect(keysForOtherAccount.size).toBe(0)
  })

  it('prepareImport resolves the account currency and flags the pre-existing transaction as a duplicate', async () => {
    const { account, expenseCategory, incomeCategory } = await setup()
    await saveTransaction(
      buildExpense({ date: '2026-08-23', description: 'Super', accountId: account.id, categoryId: expenseCategory.id, amount: money(150_000, 'ARS') }),
    )

    const mapping: CsvMapping = {
      accountId: account.id,
      expenseCategoryId: expenseCategory.id,
      incomeCategoryId: incomeCategory.id,
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-income' },
    }
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Super', '-1500'], // duplicate of the seeded transaction
      ['24/08/2026', 'Sueldo', '50000'], // genuinely new
    ]

    const preview = await prepareImport(rows, mapping)
    expect(preview[0]?.status).toBe('duplicate')
    expect(preview[1]?.status).toBe('new')
  })

  it('importSelectedRows creates exactly the selected rows, tagged and correctly categorized, and updates the balance', async () => {
    const { account, expenseCategory, incomeCategory } = await setup()
    const mapping: CsvMapping = {
      accountId: account.id,
      expenseCategoryId: expenseCategory.id,
      incomeCategoryId: incomeCategory.id,
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-income' },
    }
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Super', '-1500'],
      ['24/08/2026', 'Sueldo', '50000'],
    ]
    const preview = await prepareImport(rows, mapping)

    const result = await importSelectedRows(preview, mapping)
    expect(result.imported).toBe(2)

    const [accountWithBalance] = await listAccountsWithBalances()
    expect(accountWithBalance?.balance).toBe(100_000 - 150_000 + 5_000_000)

    const transactions = await db.transactions.toArray()
    expect(transactions.every((t) => t.tags?.includes(CSV_IMPORT_TAG))).toBe(true)
    const expenseTx = transactions.find((t) => t.description === 'Super')
    expect(expenseTx?.kind).toBe('expense')
    const incomeTx = transactions.find((t) => t.description === 'Sueldo')
    expect(incomeTx?.kind).toBe('income')
  })

  it('is all-or-nothing if an invalid row somehow slips through', async () => {
    const { account, expenseCategory, incomeCategory } = await setup()
    const mapping: CsvMapping = {
      accountId: account.id,
      expenseCategoryId: expenseCategory.id,
      incomeCategoryId: incomeCategory.id,
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-income' },
    }
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Válida', '-1500'],
      ['no es una fecha', 'Inválida', '-100'],
    ]
    const preview = await prepareImport(rows, mapping)
    expect(preview[1]?.status).toBe('invalid')

    await expect(importSelectedRows(preview, mapping)).rejects.toThrow()
    expect(await db.transactions.count()).toBe(0)
  })

  it('only imports rows the caller actually passes in (the UI filters unselected ones out)', async () => {
    const { account, expenseCategory, incomeCategory } = await setup()
    const mapping: CsvMapping = {
      accountId: account.id,
      expenseCategoryId: expenseCategory.id,
      incomeCategoryId: incomeCategory.id,
      hasHeaderRow: true,
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      dateColumn: 0,
      descriptionColumn: 1,
      amount: { mode: 'single', amountColumn: 2, signConvention: 'positive-is-income' },
    }
    const rows = [
      ['fecha', 'descripcion', 'monto'],
      ['23/08/2026', 'Uno', '-100'],
      ['24/08/2026', 'Dos', '-200'],
    ]
    const preview = await prepareImport(rows, mapping)

    const result = await importSelectedRows([preview[0]!], mapping)
    expect(result.imported).toBe(1)
    expect(await db.transactions.count()).toBe(1)
  })
})
