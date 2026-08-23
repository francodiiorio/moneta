import { z } from 'zod'

const columnIndex = z.number().int().nonnegative()

// Kept in sync by hand with CsvDateFormat (dateFormats.ts) and CsvEncoding
// (parse.ts) — small, stable literal unions where duplicating the values
// here is cheaper and clearer than threading a type-widening .map() through
// the label-pair arrays those modules own for the UI.
const dateFormatSchema = z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'])
const encodingSchema = z.enum(['utf-8', 'windows-1252'])

/** Some banks export a single signed amount column (positive/negative
 *  meaning varies by bank), others export separate debit/credit columns
 *  — both are common enough to support without guessing. */
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

export const csvMappingSchema = z.object({
  accountId: z.string().min(1, 'Elegí una cuenta'),
  expenseCategoryId: z.string().min(1, 'Elegí una categoría de gasto'),
  incomeCategoryId: z.string().min(1, 'Elegí una categoría de ingreso'),
  hasHeaderRow: z.boolean(),
  encoding: encodingSchema,
  dateFormat: dateFormatSchema,
  dateColumn: columnIndex,
  descriptionColumn: columnIndex,
  amount: amountMappingSchema,
})
export type CsvMapping = z.infer<typeof csvMappingSchema>
