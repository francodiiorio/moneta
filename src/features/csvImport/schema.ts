import { z } from 'zod'
import { CURRENCY_CODES } from '@/domain/money'

export const CSV_IMPORT_CURRENCIES = CURRENCY_CODES

const columnIndex = z.number().int().nonnegative()

// Kept in sync by hand with CsvDateFormat (dateFormats.ts) and CsvEncoding
// (parse.ts) — small, stable literal unions where duplicating the values
// here is cheaper and clearer than threading a type-widening .map() through
// the label-pair arrays those modules own for the UI.
const dateFormatSchema = z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'])
const encodingSchema = z.enum(['utf-8', 'windows-1252'])

/** Some banks export a single signed amount column (positive/negative
 *  meaning varies by bank), others export separate debit/credit columns
 *  — both are common enough to support without guessing. The credit side
 *  (positive when `signConvention` is 'positive-is-income', or the credit
 *  column) only imports into an account with an income category; anywhere
 *  else it's excluded from the preview — see service.ts. */
export const amountMappingSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('single'),
    amountColumn: columnIndex,
    signConvention: z.enum(['positive-is-income', 'positive-is-expense']),
  }),
  z.object({
    mode: z.literal('debit-credit'),
    debitColumn: columnIndex,
    creditColumn: columnIndex,
  }),
])
export type AmountMapping = z.infer<typeof amountMappingSchema>

/** Where the imported movements go. None: plain gastos, as before
 *  Etapa 8. An account: debit gastos, and — only with an income category —
 *  its credits as ingresos. A card: gastos placed by date in its
 *  statements, or all pinned to one (importing the bank's statement). */
export const csvDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('account'),
    accountId: z.string().min(1, 'Elegí una cuenta'),
    /** '' = credits aren't imported. */
    incomeCategoryId: z.string(),
  }),
  z.object({
    kind: z.literal('card'),
    cardId: z.string().min(1, 'Elegí una tarjeta'),
    /** '' = each gasto by its date. */
    statementPeriod: z.string(),
  }),
])
export type CsvDestination = z.infer<typeof csvDestinationSchema>

export const csvMappingSchema = z.object({
  destination: csvDestinationSchema,
  categoryId: z.string().min(1, 'Elegí una categoría'),
  currency: z.string().min(3).max(8),
  hasHeaderRow: z.boolean(),
  encoding: encodingSchema,
  dateFormat: dateFormatSchema,
  dateColumn: columnIndex,
  descriptionColumn: columnIndex,
  amount: amountMappingSchema,
})
export type CsvMapping = z.infer<typeof csvMappingSchema>
