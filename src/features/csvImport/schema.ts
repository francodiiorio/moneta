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
 *  — both are common enough to support without guessing. Sólo se
 *  importan gastos: el lado que no representa un gasto (positivo cuando
 *  `signConvention` es 'positive-is-income', o la columna de crédito) se
 *  excluye de la vista previa — ver service.ts. */
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
